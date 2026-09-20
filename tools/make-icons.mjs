import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function createCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4, 0) }
}

function blendPixel(canvas, x, y, color, coverage) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return
  const alpha = Math.max(0, Math.min(1, coverage)) * (color.a / 255)
  if (alpha <= 0) return
  const offset = (y * canvas.size + x) * 4
  const dstA = canvas.data[offset + 3] / 255
  const outA = alpha + dstA * (1 - alpha)
  if (outA <= 0) return
  const mix = (src, dst) => (src * alpha + dst * dstA * (1 - alpha)) / outA
  canvas.data[offset] = Math.round(mix(color.r, canvas.data[offset]))
  canvas.data[offset + 1] = Math.round(mix(color.g, canvas.data[offset + 1]))
  canvas.data[offset + 2] = Math.round(mix(color.b, canvas.data[offset + 2]))
  canvas.data[offset + 3] = Math.round(outA * 255)
}

function signedDistance(px, py, x, y, w, h, radius) {
  const cx = Math.min(Math.max(px, x + radius), x + w - radius)
  const cy = Math.min(Math.max(py, y + radius), y + h - radius)
  return Math.hypot(px - cx, py - cy) - radius
}

function fillRoundedRect(canvas, x, y, w, h, radius, color) {
  const startX = Math.max(0, Math.floor(x - 1))
  const endX = Math.min(canvas.size, Math.ceil(x + w + 1))
  const startY = Math.max(0, Math.floor(y - 1))
  const endY = Math.min(canvas.size, Math.ceil(y + h + 1))
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const d = signedDistance(px + 0.5, py + 0.5, x, y, w, h, radius)
      const coverage = Math.max(0, Math.min(1, 0.5 - d))
      if (coverage > 0) blendPixel(canvas, px, py, color, coverage)
    }
  }
}

function renderAppIcon(size) {
  const canvas = createCanvas(size)
  const s = size
  fillRoundedRect(canvas, 0, 0, s, s, s * 0.235, { r: 12, g: 12, b: 15, a: 255 })

  const pw = s * 0.62
  const ph = s * 0.255
  const px = (s - pw) / 2
  const py = (s - ph) / 2
  fillRoundedRect(canvas, px, py, pw, ph, ph / 2, { r: 246, g: 246, b: 248, a: 255 })

  const dot = ph * 0.17
  fillRoundedRect(canvas, px + ph * 0.33, s / 2 - dot, dot * 2, dot * 2, dot, {
    r: 10,
    g: 10,
    b: 12,
    a: 255
  })

  const bw = pw * 0.4
  const bh = dot * 1.5
  fillRoundedRect(canvas, px + pw * 0.45, s / 2 - bh / 2, bw, bh, bh / 2, {
    r: 10,
    g: 10,
    b: 12,
    a: 120
  })

  return encodePng(s, s, canvas.data)
}

function renderTrayIcon(size) {
  const canvas = createCanvas(size)
  const s = size
  const ink = { r: 255, g: 255, b: 255, a: 255 }
  const bw = s * 0.92
  const bh = s * 0.44
  fillRoundedRect(canvas, (s - bw) / 2, (s - bh) / 2, bw, bh, bh / 2, ink)
  const dot = bh * 0.2
  fillRoundedRect(canvas, (s - bw) / 2 + bh * 0.32, s / 2 - dot, dot * 2, dot * 2, dot, {
    r: 0,
    g: 0,
    b: 0,
    a: 255
  })
  const tw = bw * 0.36
  const th = dot * 1.4
  fillRoundedRect(canvas, (s - bw) / 2 + bw * 0.42, s / 2 - th / 2, tw, th, th / 2, {
    r: 0,
    g: 0,
    b: 0,
    a: 90
  })
  return encodePng(s, s, canvas.data)
}

function buildIco(entries) {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(entries.length, 4)
  const headerSize = 6 + entries.length * 16
  let offset = headerSize
  const headers = []
  for (const entry of entries) {
    const head = Buffer.alloc(16)
    head[0] = entry.size >= 256 ? 0 : entry.size
    head[1] = entry.size >= 256 ? 0 : entry.size
    head[2] = 0
    head[3] = 0
    head.writeUInt16LE(1, 4)
    head.writeUInt16LE(32, 6)
    head.writeUInt32LE(entry.png.length, 8)
    head.writeUInt32LE(offset, 12)
    headers.push(head)
    offset += entry.png.length
  }
  return Buffer.concat([dir, ...headers, ...entries.map((e) => e.png)])
}

mkdirSync(path.join(root, 'build'), { recursive: true })
mkdirSync(path.join(root, 'resources'), { recursive: true })

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: renderAppIcon(size) })))
writeFileSync(path.join(root, 'build', 'icon.ico'), ico)
writeFileSync(path.join(root, 'resources', 'icon.png'), renderAppIcon(256))
writeFileSync(path.join(root, 'resources', 'tray.png'), renderTrayIcon(32))

console.log('icon.ico bytes      =', ico.length)
console.log('resources/icon.png  =', renderAppIcon(256).length, 'bytes')
console.log('resources/tray.png  =', renderTrayIcon(32).length, 'bytes')
console.log('ICONS_OK')
