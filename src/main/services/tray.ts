import { Menu, Tray, app, nativeImage } from 'electron'
import { renderTrayIcon } from './icon'
import type { PanelKind } from '../../shared/types'

export interface TrayHandlers {
  onToggle: () => void
  onShowPanel: (panel: PanelKind) => void
  onSettings: () => void
  onResetSettings: () => void
  onQuit: () => void
}

let trayRef: Tray | null = null

export function createTray(handlers: TrayHandlers, visible: boolean): Tray {
  if (trayRef && !trayRef.isDestroyed()) {
    trayRef.destroy()
    trayRef = null
  }

  const icon = nativeImage.createFromBuffer(renderTrayIcon(32, true), { width: 32, height: 32 })
  const tray = new Tray(icon)
  tray.setToolTip('檐 · Eave')

  const menu = Menu.buildFromTemplate([
    {
      label: visible ? '隐藏檐' : '显示檐',
      click: () => handlers.onToggle()
    },
    { type: 'separator' },
    { label: '媒体播放', click: () => handlers.onShowPanel('media') },
    { label: '系统状态', click: () => handlers.onShowPanel('system') },
    { label: '剪贴板历史', click: () => handlers.onShowPanel('clipboard') },
    { type: 'separator' },
    { label: '外观设置', click: () => handlers.onSettings() },
    { label: '恢复默认设置', click: () => handlers.onResetSettings() },
    { type: 'separator' },
    { label: '退出', click: () => handlers.onQuit() }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => handlers.onToggle())
  tray.on('double-click', () => handlers.onToggle())

  trayRef = tray
  return tray
}

export function refreshTrayMenu(handlers: TrayHandlers, visible: boolean): void {
  if (!trayRef || trayRef.isDestroyed()) return
  const menu = Menu.buildFromTemplate([
    {
      label: visible ? '隐藏檐' : '显示檐',
      click: () => handlers.onToggle()
    },
    { type: 'separator' },
    { label: '媒体播放', click: () => handlers.onShowPanel('media') },
    { label: '系统状态', click: () => handlers.onShowPanel('system') },
    { label: '剪贴板历史', click: () => handlers.onShowPanel('clipboard') },
    { type: 'separator' },
    { label: '外观设置', click: () => handlers.onSettings() },
    { label: '恢复默认设置', click: () => handlers.onResetSettings() },
    { type: 'separator' },
    { label: `退出（v${app.getVersion()}）`, click: () => handlers.onQuit() }
  ])
  trayRef.setContextMenu(menu)
}

export function destroyTray(): void {
  if (trayRef && !trayRef.isDestroyed()) trayRef.destroy()
  trayRef = null
}
