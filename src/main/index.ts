import { app, BrowserWindow, ipcMain, shell, globalShortcut, clipboard, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import os from 'node:os'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { IslandWindow } from './window'
import { ClipboardService } from './services/clipboard'
import { SettingsStore, DEFAULT_SETTINGS } from './services/settings'
import { EaveBridge, EMPTY_MEDIA, resolvePowerShell } from './services/bridge'
import { ThumbnailService, thumbnailKey } from './services/thumbnail'
import { SysinfoService } from './services/sysinfo'
import { getWinApi } from './services/winapi'
import { StashService } from './services/stash'
import { SkinService } from './services/skins'
import { GameModeService } from './services/game'
import { createTray, destroyTray, refreshTrayMenu, type TrayHandlers } from './services/tray'
import { IPC } from '../shared/types'
import type {
  BridgeState,
  ClipboardItem,
  GameModeState,
  IslandRuntime,
  IslandSettings,
  MediaCommandPayload,
  MediaState,
  PanelKind,
  SystemState,
  ThumbnailSupport
} from '../shared/types'

const isDev = !app.isPackaged

if (process.env.ISLAND_SOFTWARE_RENDER === '1') {
  app.disableHardwareAcceleration()
}

const winapi = getWinApi()
const settings = new SettingsStore()
const sysinfo = new SysinfoService()
const clipboardService = new ClipboardService()
const stashService = new StashService()
const skinService = new SkinService()

let island: IslandWindow | null = null
let bridge: EaveBridge | null = null
let thumbs: ThumbnailService | null = null
let game: GameModeService | null = null
let lastThumbKey = ''
let runtimeInfo: IslandRuntime = detectRuntime()

function resolveBridgeScript(fileName: string): string {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'scripts', fileName) : '',
    path.join(app.getAppPath(), 'resources', 'scripts', fileName),
    path.join(__dirname, '../../resources/scripts', fileName)
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? ''
}

function detectRuntime(): IslandRuntime {
  const parts = os.release().split('.')
  const buildNumber = Number(parts[2] ?? 0)
  let platform: IslandRuntime['platform'] = 'unsupported'
  if (buildNumber >= 22000) platform = 'win11'
  else if (buildNumber >= 17763) platform = 'win10'
  return { platform, buildNumber, isFullscreen: false, pinned: false, thumbnailSupport: 'unknown' }
}

function buildSnapshot(): BridgeState {
  return {
    media: bridge?.lastMedia ?? { ...EMPTY_MEDIA },
    system: sysinfo.state,
    clipboard: clipboardService.list,
    stash: stashService.list,
    settings: settings.value,
    runtime: runtimeInfo
  }
}

function publishStash(): void {
  island?.send(IPC.stashUpdate, stashService.list)
}

function publishRuntime(patch: Partial<IslandRuntime>): void {
  runtimeInfo = { ...runtimeInfo, ...patch }
  island?.send(IPC.runtimeUpdate, runtimeInfo)
}

function applySettings(next: IslandSettings): void {
  clipboardService.configure(next.clipboardEnabled, next.clipboardLimit)
  island?.setAlwaysOnTop(next.alwaysOnTop)
  island?.setTopOffset(next.topOffset)
  game?.configure(next.gameMode, next.gameExclude)
  try {
    app.setLoginItemSettings({ openAtLogin: next.autoStart, path: process.execPath })
  } catch {
    /* login item registration is best-effort */
  }
}

function updateClipboard(items: ClipboardItem[]): void {
  island?.send(IPC.clipboardUpdate, items)
}

/** 曲目变化时刷新封面：先清掉旧封面，再异步抓新的 */
function syncThumbnail(state: MediaState): void {
  if (!thumbs) return
  if (!state.available) {
    lastThumbKey = ''
    bridge?.clearThumbnail()
    return
  }
  const key = thumbnailKey(state.title, state.artist, state.album)
  if (key === lastThumbKey) return
  lastThumbKey = key
  bridge?.clearThumbnail()
  thumbs.request(key)
}

function probeThumbnail(): Promise<ThumbnailSupport> {
  const scriptPath = resolveBridgeScript('eave-thumb.ps1')
  return new Promise((resolve) => {
    if (!existsSync(scriptPath)) {
      resolve('unavailable')
      return
    }
    let child
    try {
      child = spawn(
        resolvePowerShell(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Probe'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch {
      resolve('unavailable')
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (value: ThumbnailSupport): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-800)
    })
    child.on('error', () => finish('unavailable'))
    child.on('exit', (code) => {
      const ok = code === 0 && /PROBE_OK/.test(stdout)
      console.log(
        ok ? '[thumb] probe ok' : `[thumb] probe failed code=${code} ${stderr.trim().slice(0, 300)}`
      )
      finish(ok ? 'available' : 'unavailable')
    })

    setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish('unavailable')
    }, 45000)
  })
}

async function runProbeAndPublish(): Promise<ThumbnailSupport> {
  const result = await probeThumbnail()
  if (thumbs && result === 'available') thumbs.reset()
  publishRuntime({ thumbnailSupport: result })
  syncThumbnail(bridge?.lastMedia ?? { ...EMPTY_MEDIA })
  return result
}

function setupIpc(): void {
  ipcMain.handle(IPC.snapshot, () => buildSnapshot())

  ipcMain.handle(IPC.thumbnailProbe, () => runProbeAndPublish())

  ipcMain.on(IPC.setInteractive, (_event, interactive: unknown, focusable: unknown) => {
    island?.setInteractive(Boolean(interactive))
    if (typeof focusable === 'boolean') island?.setFocusable(focusable)
  })

  ipcMain.on(IPC.mediaCommand, (_event, payload: MediaCommandPayload) => {
    const action = payload?.action
    if (action === 'next' || action === 'previous' || action === 'playpause') {
      winapi.tapKey(action)
    }
  })

  ipcMain.on(IPC.volumeCommand, (_event, action: string) => {
    if (action === 'up' || action === 'down' || action === 'mute') {
      winapi.tapKey(action === 'up' ? 'volumeUp' : action === 'down' ? 'volumeDown' : 'volumeMute')
    }
  })

  ipcMain.on(IPC.settingsPatch, (_event, patch: Partial<IslandSettings>) => {
    const next = settings.patch(patch ?? {})
    applySettings(next)
    island?.send(IPC.settingsUpdate, next)
  })

  ipcMain.on(IPC.clipboardAction, (_event, payload: { type: string; id?: string }) => {
    if (payload.type === 'pin' && payload.id) {
      updateClipboard(clipboardService.togglePin(payload.id))
    } else if (payload.type === 'remove' && payload.id) {
      updateClipboard(clipboardService.remove(payload.id))
    } else if (payload.type === 'clear') {
      updateClipboard(clipboardService.clearUnpinned())
    } else if (payload.type === 'clearAll') {
      updateClipboard(clipboardService.clearAll())
    }
  })

  ipcMain.on(IPC.windowAction, (_event, action: string) => {
    if (action === 'hide') island?.hide()
    else if (action === 'toggle') toggleIsland()
    else if (action === 'quit') app.quit()
    else if (action === 'settings-file') void shell.showItemInFolder(settings.location)
  })

  ipcMain.on(IPC.openExternal, (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(IPC.skinsAction, async (event, payload: { action: string; id?: string }) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (payload.action === 'list') return { ok: true, skins: skinService.list(), error: '' }
    if (payload.action === 'import') {
      const result = await skinService.import(parent)
      island?.send(IPC.skinsUpdate, skinService.list())
      return result
    }
    if (payload.action === 'export' && payload.id) {
      return skinService.export(parent, payload.id)
    }
    if (payload.action === 'delete' && payload.id) {
      const result = skinService.delete(payload.id)
      // 删除的皮肤可能是激活中的：主进程主动摘掉引用
      if (result.ok && settings.value.activeSkin === payload.id) {
        const next = settings.patch({ activeSkin: '' })
        applySettings(next)
        island?.send(IPC.settingsUpdate, next)
      }
      island?.send(IPC.skinsUpdate, skinService.list())
      return result
    }
    return { ok: false, error: '未知操作' }
  })

  ipcMain.handle(
    IPC.stashAction,
    (_event, payload: { type: string; id?: string; paths?: string[] }): { ok: boolean; error: string } => {
      const type = payload?.type
      if (type === 'add' && Array.isArray(payload.paths)) {
        const safe = payload.paths.filter((p) => typeof p === 'string' && path.isAbsolute(p))
        if (safe.length === 0) return { ok: false, error: '没有可暂存的本地文件' }
        const result = stashService.add(safe)
        publishStash()
        return { ok: result.added > 0, error: result.error }
      }
      if (type === 'remove' && payload.id) {
        stashService.remove(payload.id)
        publishStash()
        return { ok: true, error: '' }
      }
      if (type === 'clear') {
        stashService.clear()
        publishStash()
        return { ok: true, error: '' }
      }
      if (type === 'copyPath' && payload.id) {
        const target = stashService.resolve(payload.id)
        if (!target) return { ok: false, error: '原文件已不在了' }
        clipboard.writeText(target)
        return { ok: true, error: '' }
      }
      if (type === 'reveal' && payload.id) {
        const target = stashService.resolve(payload.id)
        if (!target) return { ok: false, error: '原文件已不在了' }
        shell.showItemInFolder(target)
        return { ok: true, error: '' }
      }
      if (type === 'startDrag' && payload.id) {
        const target = stashService.resolve(payload.id)
        if (!target) return { ok: false, error: '原文件已不在了' }
        // dev 下 icon 在项目 resources/，打包后在 resourcesPath/
        const iconPath = [
          process.resourcesPath ? path.join(process.resourcesPath, 'icon.png') : '',
          path.join(app.getAppPath(), 'resources', 'icon.png')
        ].find((candidate) => candidate && existsSync(candidate))
        const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
        const win = island?.browserWindow
        if (!win) return { ok: false, error: '窗口不在' }
        try {
          // Item 类型要求 icon；空图时也传入，运行时异常走 catch 兜底
          win.webContents.startDrag({ file: target, icon })
          return { ok: true, error: '' }
        } catch (error) {
          return { ok: false, error: String(error).replace(/^[^:]*:\s*/, '') }
        }
      }
      return { ok: false, error: '未知操作' }
    }
  )
}

function toggleIsland(): boolean {
  if (!island) return false
  const visible = island.toggle()
  refreshTrayMenu(trayHandlers, visible)
  return visible
}

const trayHandlers: TrayHandlers = {
  onToggle: () => {
    toggleIsland()
  },
  onShowPanel: (panel: PanelKind) => {
    island?.show()
    island?.send(IPC.setPanel, panel)
  },
  onSettings: () => {
    island?.show()
    island?.send(IPC.setPanel, 'settings')
  },
  onResetSettings: () => {
    const next = settings.reset()
    applySettings(next)
    island?.send(IPC.settingsUpdate, next)
  },
  onQuit: () => {
    app.quit()
  }
}

function startServices(): void {
  sysinfo.start((state: SystemState) => island?.send(IPC.systemUpdate, state), 1000)

  // 游戏形态：全屏检测 1Hz（koffi，零子进程）；GPU 短进程按需拉起
  game = new GameModeService({
    resolvePowerShell,
    resolveScript: (name) => resolveBridgeScript(name),
    onLog: (message) => {
      if (isDev) console.log(message)
    }
  })
  game.start(
    (state: GameModeState) => island?.send(IPC.gameUpdate, state),
    (value) => sysinfo.setGpu(value),
    1000
  )
  game.configure(settings.value.gameMode, settings.value.gameExclude)

  clipboardService.configure(settings.value.clipboardEnabled, settings.value.clipboardLimit)
  clipboardService.start((items) => updateClipboard(items), 1200)

  thumbs = new ThumbnailService(
    resolveBridgeScript('eave-thumb.ps1'),
    (key, dataUrl) => {
      if (key === lastThumbKey) bridge?.applyThumbnail(dataUrl)
    },
    (message) => {
      if (isDev) console.log(message)
    }
  )

  bridge = new EaveBridge(resolveBridgeScript('eave-bridge.ps1'), {
    onMedia: (state: MediaState) => {
      island?.send(IPC.mediaUpdate, state)
      syncThumbnail(state)
    },
    onNet: (rate) => sysinfo.setNetRate(rate),
    onHealthChange: (healthy, detail) => {
      if (!healthy) island?.send(IPC.mediaUpdate, { ...EMPTY_MEDIA })
      console.warn(`[bridge] healthy=${healthy} ${detail}`)
    },
    onLog: (message) => {
      if (isDev) console.log(message)
    }
  })
  bridge.start()

  if (winapi.issues.length > 0) {
    console.warn('[winapi] degraded:', winapi.issues.join(' | '))
  }
}

function bootstrap(): void {
  runtimeInfo = detectRuntime()

  island = new IslandWindow({
    topOffset: settings.value.topOffset,
    alwaysOnTop: settings.value.alwaysOnTop,
    devServerUrl: process.env['ELECTRON_RENDERER_URL']
  })
  const win = island.create()

  // 隐藏时彻底停掉 PowerShell 子进程，展开后再拉起（省内存+省 CPU）
  win.on('hide', () => bridge?.setPaused(true))
  win.on('show', () => bridge?.setPaused(false))

  applySettings(settings.value)
  setupIpc()
  createTray(trayHandlers, true)
  startServices()

  try {
    globalShortcut.register('Control+Alt+E', () => {
      toggleIsland()
    })
  } catch {
    /* shortcut may already be taken */
  }

  // 开机后静默自检一次封面抓取能力（结果会缓存成 DLL，后续几乎零成本）
  const autoProbe = setTimeout(() => {
    if (runtimeInfo.thumbnailSupport === 'unknown') void runProbeAndPublish()
  }, 3000)
  autoProbe.unref?.()
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    island?.show()
    refreshTrayMenu(trayHandlers, true)
  })

  app.whenReady().then(() => {
    if (process.platform !== 'win32') {
      console.error('This build targets Windows 10/11 only.')
      app.quit()
      return
    }
    bootstrap()
  })
}

app.on('window-all-closed', () => {
  /* tray resident application: keep running */
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  bridge?.dispose()
  thumbs?.dispose()
  game?.stop()
  sysinfo.stop()
  clipboardService.stop()
  destroyTray()
})

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception', error)
})

export { DEFAULT_SETTINGS }
