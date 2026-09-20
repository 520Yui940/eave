// 造一个带封面的 SMTC 媒体会话（本地 Chrome + 自造 WAV/PNG），
// 用来在没有真实播放器的环境下端到端验证封面抓取链路。
import http from 'node:http'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const dir = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** puppeteer-core：优先本地 node_modules，其次 WORKSPACE_NODE_MODULES 指向的目录 */
function loadPuppeteer() {
  try {
    return require('puppeteer-core')
  } catch {
    /* 本地未安装，走环境变量回退 */
  }
  const workspace = process.env.WORKSPACE_NODE_MODULES
  if (workspace) {
    const req = createRequire(path.join(workspace, 'package.json'))
    return req('puppeteer-core')
  }
  throw new Error(
    'puppeteer-core 未找到：npm i -D puppeteer-core，或设置 WORKSPACE_NODE_MODULES 指向包含它的 node_modules 目录'
  )
}

function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function makePng(size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0
    for (let x = 0; x < size; x++) {
      raw[p++] = Math.floor((255 * x) / size)
      raw[p++] = Math.floor((255 * y) / size)
      raw[p++] = x > size / 2 === y > size / 2 ? 240 : 40
      raw[p++] = 255
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function makeWav(seconds = 2, freq = 440) {
  const rate = 44100
  const n = rate * seconds
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export async function startFakeMedia() {
  const puppeteer = loadPuppeteer()
  const png = makePng(300)
  const wav = makeWav()

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Eave fake media</title></head>
<body style="background:#111;color:#eee;font-family:sans-serif">
<h3>Eave fake media session</h3>
<audio id="a" loop autoplay></audio>
<script>
const a = document.getElementById('a');
a.src = '/tone.wav';
a.volume = 0.12;
a.play().catch(() => {});
if ('mediaSession' in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Eave Test Track',
    artist: 'Yuhan',
    album: 'Build Verification',
    artwork: [{ src: '/cover.png', sizes: '300x300', type: 'image/png' }]
  });
  navigator.mediaSession.playbackState = 'playing';
}
</script>
</body></html>`

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/cover.png')) {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(png)
    } else if (req.url.startsWith('/tone.wav')) {
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      res.end(wav)
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const chrome = path.join(
    process.env['ProgramFiles'] || 'C:\\Program Files',
    'Google',
    'Chrome',
    'Application',
    'chrome.exe'
  )

  let browser = null
  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: false,
      args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check']
    })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 3500))
    console.log('FAKE_MEDIA', `port=${port}`, await page.evaluate(() => navigator.mediaSession?.playbackState ?? 'none'))
  } catch (error) {
    console.log('FAKE_MEDIA_FAIL', String(error).slice(0, 200))
  }

  return {
    async stop() {
      try {
        if (browser) await browser.close()
      } catch {
        /* ignore */
      }
      try {
        server.close()
      } catch {
        /* ignore */
      }
    }
  }
}

export { dir }
