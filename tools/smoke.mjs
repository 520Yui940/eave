import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
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
const packagedExe = process.env.EAVE_EXE || process.env.ISLAND_EXE
const electronBin = packagedExe || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const cacheDir = path.join(root, '.cache')
const PORT = packagedExe ? 9444 : 9333
const tag = packagedExe ? 'packaged' : 'dev'

mkdirSync(cacheDir, { recursive: true })

const logs = []
const childEnv = {
  ...process.env,
  ELECTRON_ENABLE_LOGGING: '1',
  ISLAND_SOFTWARE_RENDER: '1'
}
delete childEnv.ELECTRON_RUN_AS_NODE

const args = [
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  '--disable-gpu',
  '--in-process-gpu'
]
// 独立 userData：避免与桌面上正在运行的已安装 Eave 抢单实例锁（requestSingleInstanceLock）
// 冲突后 app.quit() 静默退出，表现为 CDP 连不上且无任何日志。可用 EAVE_DEV_PROFILE 覆盖。
// dev 与打包版都需要（两者 userData 同名，锁冲突方式相同）。
const profileDir = process.env.EAVE_DEV_PROFILE || path.join(cacheDir, 'dev-profile')
args.push(`--user-data-dir=${profileDir}`)
if (!packagedExe) args.push('.')

const child = spawn(electronBin, args, { cwd: root, env: childEnv })

child.stdout.on('data', (d) => logs.push(String(d)))
child.stderr.on('data', (d) => logs.push(String(d)))
child.on('error', (error) => logs.push(`SPAWN_ERROR ${String(error)}\n`))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// EAVE_FAKE_MEDIA=1 时先开一个带封面的 Chrome 媒体会话，用于验证专辑封面链路
const fakeMedia = process.env.EAVE_FAKE_MEDIA === '1' ? await startFakeMedia() : null

async function shoot(page, name) {
  const file = path.join(cacheDir, `${tag}-${name}.png`)
  await page.screenshot({ path: file, omitBackground: true })
  console.log('SHOT', `${tag}-${name}.png`)
}

try {
  await wait(9000)

  let browser = null
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null })
  } catch (error) {
    console.log('CDP_CONNECT_FAIL', String(error))
  }

  if (browser) {
    const pages = await browser.pages()
    console.log('PAGE_COUNT', pages.length)
    const page = pages.find((p) => p.url().includes('index')) ?? pages[pages.length - 1]
    console.log('PAGE_URL', page.url())
    console.log('TITLE', await page.title())

    const islandBox = await page.evaluate(() => {
      const el = document.querySelector('[data-eave-surface]')
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, cls: el.className }
    })
    console.log('ISLAND_BOX', JSON.stringify(islandBox))

    const snapshot = await page.evaluate(async () => {
      const state = await window.eave.snapshot()
      return {
        mediaAvailable: state.media.available,
        mediaTitle: state.media.title,
        mediaApp: state.media.appName,
        cpu: state.system.cpu,
        memUsed: state.system.memUsedBytes,
        memTotal: state.system.memTotalBytes,
        netDown: state.system.netDownBps,
        netUp: state.system.netUpBps,
        battery: state.system.battery,
        clipboardCount: state.clipboard.length,
        platform: state.runtime.platform,
        build: state.runtime.buildNumber,
        topOffset: state.settings.topOffset,
        idleClock: state.settings.idleClock,
        motion: state.settings.motion,
        thumbnailSupport: state.runtime.thumbnailSupport,
        mediaThumbnail: state.media.thumbnail ? state.media.thumbnail.slice(0, 40) : '',
        mediaThumbnailReal: state.media.thumbnailReal
      }
    })
    console.log('SNAPSHOT', JSON.stringify(snapshot))

    // 先把鼠标挪到窗口角落，确保拍到的是真正的「常驻态」
    await page.mouse.move(4, 350)
    await wait(900)

    const pillText = await page.evaluate(() => {
      const el = document.querySelector('.pill')
      return el ? el.textContent : 'missing'
    })
    console.log('PILL_TEXT', JSON.stringify(pillText))

    await shoot(page, 'idle')

    if (islandBox) {
      const cx = islandBox.x + islandBox.width / 2
      const cy = islandBox.y + islandBox.height / 2
      await page.mouse.move(cx, cy)
      await wait(900)
      // 点击穿透窗口初次拿焦点有竞争，补一次微小抖动再读一次状态
      await page.mouse.move(cx + 2, cy + 1)
      await wait(900)
      const cls = await page.evaluate(() => {
        const el = document.querySelector('[data-eave-surface]')
        return el ? el.className : 'missing'
      })
      console.log('AFTER_HOVER_CLASS', cls)
      await shoot(page, 'expanded')

      const tabs = await page.$$('.tab')
      console.log('TAB_COUNT', tabs.length)
      if (tabs.length >= 4) {
        await tabs[0].click()
        await wait(3500)
        await shoot(page, 'media')

        const cover = await page.evaluate(() => {
          const img = document.querySelector('.cover img')
          const ph = document.querySelector('.cover__ph')
          const aura = document.querySelector('.aura')
          return {
            hasImg: Boolean(img),
            srcLen: img ? img.src.length : 0,
            srcHead: img ? img.src.slice(0, 30) : '',
            naturalWidth: img ? img.naturalWidth : 0,
            hasPlaceholder: Boolean(ph),
            hasAura: Boolean(aura),
            title: document.querySelector('.hero__title')?.textContent ?? '',
            source: document.querySelector('.hero__source')?.textContent ?? ''
          }
        })
        console.log('COVER', JSON.stringify(cover))

        for (const [index, name] of [
          [1, 'system'],
          [2, 'clipboard'],
          [3, 'timers'],
          [4, 'tools'],
          [5, 'stash'],
          [6, 'settings']
        ]) {
          // 每次重新查询：切面板会重渲染，旧的 ElementHandle 会 detached
          const current = await page.$$('.tab')
          if (current[index]) {
            await current[index].click()
            await wait(700)
            await shoot(page, name)
          } else {
            console.log('MISSING_TAB', name)
          }
        }

        const second = await page.evaluate(async () => {
          const state = await window.eave.snapshot()
          return {
            title: state.media.title,
            artist: state.media.artist,
            thumbLen: state.media.thumbnail.length,
            thumbReal: state.media.thumbnailReal,
            support: state.runtime.thumbnailSupport
          }
        })
        console.log('MEDIA_AFTER', JSON.stringify(second))
      }
    }

    browser.disconnect()
  }
} catch (error) {
  logs.push(`SMOKE_ERROR ${String(error)}\n`)
  console.log('SMOKE_ERROR', String(error))
} finally {
  await wait(400)
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  await wait(900)
  if (fakeMedia) await fakeMedia.stop()
  const text = logs.join('')
  writeFileSync(path.join(cacheDir, `smoke-${tag}.log`), text, 'utf-8')
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  console.log(`--- LOG (${tag}, last 30) ---`)
  console.log(
    lines
      .filter((l) => !l.includes('Security Warning') && !l.includes('electronjs.org') && !l.includes('unnecessary security'))
      .slice(-30)
      .join('\n')
  )
  process.exit(0)
}
