import { BrowserWindow, screen, shell } from 'electron'
import path from 'node:path'

export const WINDOW_WIDTH = 440
export const WINDOW_HEIGHT = 360

export interface WindowOptions {
  topOffset: number
  alwaysOnTop: boolean
  devServerUrl?: string
}

export class IslandWindow {
  private win: BrowserWindow | null = null
  private interactive = false
  private options: WindowOptions

  constructor(options: WindowOptions) {
    this.options = options
  }

  get browserWindow(): BrowserWindow | null {
    return this.win
  }

  get isInteractive(): boolean {
    return this.interactive
  }

  create(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,
      thickFrame: false,
      // Win11(22000+) 默认 roundedCorners: true —— 系统会给无边框窗口自己描一圈圆角，
      // 在透明窗口上就表现为「抠不干净的黑边」。必须显式关掉。
      roundedCorners: false,
      // 别让系统在窗口后面垫 Mica/Acrylic，否则透明区域会被染上一层底色
      backgroundMaterial: 'none',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: !process.env.ISLAND_PROD
      }
    })

    win.setMenuBarVisibility(false)
    // 双保险：显式把窗口底色重置为全透明（有些 DWM 状态下会沿用构造时的默认底色）
    win.setBackgroundColor('#00000000')
    this.applyAlwaysOnTop(this.options.alwaysOnTop)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setIgnoreMouseEvents(true, { forward: true })

    win.once('ready-to-show', () => {
      this.reposition()
      win.showInactive()
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      const isInternal = this.options.devServerUrl && url.startsWith(this.options.devServerUrl)
      if (!isInternal) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })

    if (this.options.devServerUrl) {
      void win.loadURL(this.options.devServerUrl)
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    this.win = win
    return win
  }

  private applyAlwaysOnTop(enabled: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    if (enabled) {
      this.win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      this.win.setAlwaysOnTop(false)
    }
  }

  setAlwaysOnTop(enabled: boolean): void {
    this.options.alwaysOnTop = enabled
    this.applyAlwaysOnTop(enabled)
  }

  setTopOffset(offset: number): void {
    this.options.topOffset = offset
    this.reposition()
  }

  reposition(): void {
    if (!this.win || this.win.isDestroyed()) return
    const display = screen.getPrimaryDisplay()
    const area = display.workArea
    const x = Math.round(area.x + (area.width - WINDOW_WIDTH) / 2)
    const y = Math.round(area.y + this.options.topOffset)
    this.win.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
  }

  setInteractive(next: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    if (next === this.interactive) return
    this.interactive = next
    if (next) {
      this.win.setIgnoreMouseEvents(false)
    } else {
      this.win.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  setFocusable(focusable: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    if (this.win.isFocusable() === focusable) return
    this.win.setFocusable(focusable)
  }

  show(): void {
    if (!this.win || this.win.isDestroyed()) return
    this.reposition()
    this.win.showInactive()
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return
    this.setInteractive(false)
    this.win.hide()
  }

  toggle(): boolean {
    if (!this.win || this.win.isDestroyed()) return false
    if (this.win.isVisible()) {
      this.hide()
      return false
    }
    this.show()
    return true
  }

  isVisible(): boolean {
    if (!this.win || this.win.isDestroyed()) return false
    return this.win.isVisible()
  }

  isFullscreenActive(): boolean {
    if (!this.win || this.win.isDestroyed()) return false
    return this.win.isFullScreen()
  }

  send(channel: string, payload?: unknown): void {
    if (!this.win || this.win.isDestroyed()) return
    this.win.webContents.send(channel, payload)
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
