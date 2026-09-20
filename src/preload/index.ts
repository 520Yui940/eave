import { contextBridge, ipcRenderer, webUtils } from 'electron'
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
  SkinDef,
  StashEntry,
  SystemState,
  ThumbnailSupport
} from '../shared/types'

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  snapshot: (): Promise<BridgeState> => ipcRenderer.invoke(IPC.snapshot) as Promise<BridgeState>,
  setInteractive: (interactive: boolean, focusable?: boolean): void => {
    ipcRenderer.send(IPC.setInteractive, interactive, focusable)
  },
  mediaCommand: (payload: MediaCommandPayload): void => {
    ipcRenderer.send(IPC.mediaCommand, payload)
  },
  volumeCommand: (action: 'up' | 'down' | 'mute'): void => {
    ipcRenderer.send(IPC.volumeCommand, action)
  },
  clipboardAction: (payload: { type: 'pin' | 'remove' | 'clear' | 'clearAll'; id?: string }): void => {
    ipcRenderer.send(IPC.clipboardAction, payload)
  },
  windowAction: (action: 'hide' | 'toggle' | 'quit' | 'settings-file'): void => {
    ipcRenderer.send(IPC.windowAction, action)
  },
  patchSettings: (patch: Partial<IslandSettings>): void => {
    ipcRenderer.send(IPC.settingsPatch, patch)
  },
  openExternal: (url: string): void => {
    ipcRenderer.send(IPC.openExternal, url)
  },
  probeThumbnail: (): Promise<ThumbnailSupport> =>
    ipcRenderer.invoke(IPC.thumbnailProbe) as Promise<ThumbnailSupport>,
  /** 拖放文件 → 本地绝对路径（Electron 32+ 移除了 File.path，官方推荐走 webUtils） */
  filePath: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  skinsList: (): Promise<SkinDef[]> =>
    ipcRenderer
      .invoke(IPC.skinsAction, { action: 'list' })
      .then((result: { skins?: SkinDef[] }) => result.skins ?? []),
  skinsAction: (action: 'import' | 'export' | 'delete', id?: string): Promise<{ ok: boolean; error: string }> =>
    ipcRenderer.invoke(IPC.skinsAction, { action, id }) as Promise<{ ok: boolean; error: string }>,
  stashAction: (
    payload: { type: 'add' | 'remove' | 'clear' | 'copyPath' | 'reveal' | 'startDrag'; id?: string; paths?: string[] }
  ): Promise<{ ok: boolean; error: string }> =>
    ipcRenderer.invoke(IPC.stashAction, payload) as Promise<{ ok: boolean; error: string }>,
  onSkins: (handler: (skins: SkinDef[]) => void): (() => void) => subscribe(IPC.skinsUpdate, handler),
  onStash: (handler: (entries: StashEntry[]) => void): (() => void) => subscribe(IPC.stashUpdate, handler),
  onGame: (handler: (state: GameModeState) => void): (() => void) => subscribe(IPC.gameUpdate, handler),
  onMedia: (handler: (state: MediaState) => void): (() => void) => subscribe(IPC.mediaUpdate, handler),
  onSystem: (handler: (state: SystemState) => void): (() => void) => subscribe(IPC.systemUpdate, handler),
  onClipboard: (handler: (items: ClipboardItem[]) => void): (() => void) =>
    subscribe(IPC.clipboardUpdate, handler),
  onSettings: (handler: (settings: IslandSettings) => void): (() => void) =>
    subscribe(IPC.settingsUpdate, handler),
  onRuntime: (handler: (runtime: IslandRuntime) => void): (() => void) =>
    subscribe(IPC.runtimeUpdate, handler),
  onPanel: (handler: (panel: PanelKind) => void): (() => void) => subscribe(IPC.setPanel, handler)
}

contextBridge.exposeInMainWorld('eave', api)

export type EaveApi = typeof api
