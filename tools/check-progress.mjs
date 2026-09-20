// 进度条走动检测：展开媒体面板，连续采样 progress 文本与 fill 宽度
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeMedia } from './fake-media.mjs'

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

const puppeteer = loadPuppeteer()

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const childEnv = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
delete childEnv.ELECTRON_RUN_AS_NODE

const fakeMedia = process.env.EAVE_FAKE_MEDIA === '1' ? await startFakeMedia() : null

const child = spawn(
  electronBin,
  [
    '--remote-debugging-port=9333',
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${path.join(root, '.cache', 'dev-profile')}`,
    '.'
  ],
  { cwd: root, env: childEnv }
)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await wait(9000)
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null })
  const pages = await browser.pages()
  const page = pages.find((p) => p.url().includes('index')) ?? pages[pages.length - 1]

  // 展开并切到媒体面板
  await page.mouse.move(220, 23)
  await wait(1000)
  await page.mouse.move(222, 24)
  await wait(1200)
  const tabs = await page.$$('.tab')
  if (tabs[0]) await tabs[0].click()
  await wait(1200)

  for (let i = 0; i < 5; i++) {
    const sample = await page.evaluate(() => {
      const time = document.querySelector('.progress__time')?.textContent ?? 'N/A'
      const fill = document.querySelector('.progress__fill')
      const width = fill ? fill.style.width : 'N/A'
      const status = document.querySelector('.hero__source')?.textContent ?? 'N/A'
      return window.eave.snapshot().then((s) => ({
        time,
        width,
        status,
        mStatus: s.media.status,
        position: s.media.position,
        duration: s.media.duration,
        title: s.media.title,
        app: s.media.appName
      }))
    })
    console.log(
      `SAMPLE ${i}: ui=${sample.time}/${sample.width} status=${sample.mStatus} pos=${sample.position} dur=${sample.duration} app=${sample.app} title=${sample.title.slice(0, 20)}`
    )
    await wait(2000)
  }
  browser.disconnect()
} catch (error) {
  console.log('PROGRESS_CHECK_ERROR', String(error))
} finally {
  await wait(300)
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  if (fakeMedia) await fakeMedia.stop()
  await wait(800)
  process.exit(0)
}
