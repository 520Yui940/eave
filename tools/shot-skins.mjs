// 皮肤预览脚本：逐个激活内置皮肤并截图（dev profile，不污染真实配置）
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
const cacheDir = path.join(root, '.cache')

const childEnv = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
delete childEnv.ELECTRON_RUN_AS_NODE

const child = spawn(
  electronBin,
  [
    '--remote-debugging-port=9333',
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${path.join(cacheDir, 'dev-profile')}`,
    '.'
  ],
  { cwd: root, env: childEnv }
)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  await wait(9000)
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null })
  const pages = await browser.pages()
  const page = pages.find((p) => p.url().includes('index')) ?? pages[pages.length - 1]

  const skins = [
    ['', 'default'],
    ['builtin:cream', 'cream'],
    ['builtin:glass', 'glass'],
    ['builtin:terminal', 'terminal']
  ]

  for (const [id, name] of skins) {
    await page.evaluate((skinId) => window.eave.patchSettings({ activeSkin: skinId }), id)
    await wait(900)
    // 胶囊态
    await page.mouse.move(4, 350)
    await wait(700)
    await page.screenshot({ path: path.join(cacheDir, `skin-${name}-pill.png`), omitBackground: true })
    // 展开态（系统面板）
    await page.mouse.move(220, 23)
    await wait(900)
    await page.mouse.move(222, 24)
    await wait(900)
    await page.screenshot({ path: path.join(cacheDir, `skin-${name}-expanded.png`), omitBackground: true })
    console.log('SHOT', name)
  }

  // 恢复默认，避免 dev profile 留在皮肤态
  await page.evaluate(() => window.eave.patchSettings({ activeSkin: '' }))
  browser.disconnect()
} catch (error) {
  console.log('SKIN_SHOT_ERROR', String(error))
} finally {
  await wait(400)
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  await wait(800)
  process.exit(0)
}
