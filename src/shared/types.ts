export type PlaybackStatus = 'Closed' | 'Opened' | 'Changing' | 'Stopped' | 'Playing' | 'Paused'

/** 空媒体状态的唯一来源：主进程与渲染层共用，避免两处手抄漂移 */
export const EMPTY_MEDIA: MediaState = {
  available: false,
  sourceAppId: '',
  appName: '',
  title: '',
  artist: '',
  album: '',
  status: 'Closed',
  position: 0,
  duration: 0,
  thumbnail: '',
  thumbnailReal: false,
  canNext: false,
  canPrev: false,
  canPlayPause: false
}

export interface MediaState {
  available: boolean
  sourceAppId: string
  appName: string
  title: string
  artist: string
  album: string
  status: PlaybackStatus
  position: number
  duration: number
  /** 封面 dataURL；为空表示走占位美术 */
  thumbnail: string
  /** 封面是否来自真实抓取（false = 占位） */
  thumbnailReal: boolean
  canNext: boolean
  canPrev: boolean
  canPlayPause: boolean
}

export interface BatteryState {
  hasBattery: boolean
  percent: number
  charging: boolean
}

export interface SystemState {
  cpu: number
  /** GPU 引擎综合占用 %（性能计数器，拿不到时为 -1） */
  gpu: number
  memUsedBytes: number
  memTotalBytes: number
  netDownBps: number
  netUpBps: number
  battery: BatteryState
  uptimeSeconds: number
}

export type ClipboardKind = 'text' | 'image' | 'files'

export interface ClipboardItem {
  id: string
  kind: ClipboardKind
  text: string
  preview: string
  imageDataUrl: string
  sizeBytes: number
  time: number
  pinned: boolean
}

export interface IslandSettings {
  theme: 'dark' | 'light' | 'auto'
  accent: string
  /** 播放时强调色跟随专辑封面主色（取色结果按曲目缓存，计算一次性） */
  accentFromCover: boolean
  opacity: number
  scale: number
  topOffset: number
  hideOnFullscreen: boolean
  alwaysOnTop: boolean
  autoStart: boolean
  clipboardEnabled: boolean
  clipboardLimit: number
  /** 常驻态是否显示时钟（关闭则胶囊更窄） */
  idleClock: boolean
  /** 动效强度：full = 全部花活；calm = 只保留必要过渡（省 CPU/GPU） */
  motion: 'full' | 'calm'
  /** 是否绘制投影（关掉可彻底消除某些显卡下的边缘染色） */
  shadow: boolean
  /** 计时器/番茄钟结束时是否播放提示音（Web Audio 短哔，无素材） */
  soundEnabled: boolean
  /** 天气城市，空 = 按 IP 自动定位（wttr.in，30 分钟缓存） */
  weatherCity: string
  /** 激活的皮肤 id，空 = 不启用皮肤（内置 id 见 skins.ts） */
  activeSkin: string
  /** 前台全屏时切换游戏迷你条 */
  gameMode: boolean
  /** 岛内住客（二次元小人）显示开关 */
  companionEnabled: boolean
  /** 游戏形态排除名单（exe 名，小写，不含路径） */
  gameExclude: string[]
  modules: {
    media: boolean
    system: boolean
    clipboard: boolean
    volume: boolean
  }
}

export type PanelKind = 'idle' | 'media' | 'system' | 'clipboard' | 'timers' | 'tools' | 'stash' | 'settings'

/* ---- 皮肤系统 ---- */

/** 一个皮肤在某主题档下的调色板；字段与 styles.css :root 的变量一一对应 */
export interface SkinPalette {
  /** 岛体底色（含透明度），对应 --island-bg 的颜色部分 */
  bg: string
  raised: string
  sunken: string
  text: string
  textDim: string
  textFaint: string
  hairline: string
  accent: string
}

export interface SkinDef {
  id: string
  name: string
  builtin: boolean
  /** 背景图绝对路径；空 = 纯色皮肤。导入时由主进程复制进 userData */
  bgImage: string
  /** 背景图模糊 px / 暗化 0~1 / 不透明度 0~1 */
  bgBlur: number
  bgDim: number
  bgOpacity: number
  dark: SkinPalette
  light: SkinPalette
  night: SkinPalette
}

/* ---- 文件暂存 ---- */

export interface StashEntry {
  id: string
  name: string
  /** 文件或文件夹的绝对路径（复制模式下是 stash 目录内路径） */
  path: string
  kind: 'file' | 'folder'
  /** copy = 已复制进 stash 目录；ref = 仅引用原路径 */
  stored: 'copy' | 'ref'
  sizeBytes: number
  time: number
}

/* ---- 游戏形态 ---- */

export interface GameModeState {
  active: boolean
  /** 触发时前台全屏进程的 exe 名（小写） */
  exeName: string
  startedAt: number
}

export type ThumbnailSupport = 'unknown' | 'available' | 'unavailable'

export interface IslandRuntime {
  platform: 'win10' | 'win11' | 'unsupported'
  buildNumber: number
  isFullscreen: boolean
  pinned: boolean
  /** 真实封面抓取能力：unknown=未探测, available=可用, unavailable=本机拿不到 */
  thumbnailSupport: ThumbnailSupport
}

export interface BridgeState {
  media: MediaState
  system: SystemState
  clipboard: ClipboardItem[]
  stash: StashEntry[]
  settings: IslandSettings
  runtime: IslandRuntime
}

export interface MediaCommandPayload {
  action: 'playpause' | 'next' | 'previous' | 'seek'
  position?: number
}

export interface SettingsPatch {
  [key: string]: unknown
}

export const IPC = {
  snapshot: 'eave:snapshot',
  mediaUpdate: 'eave:media-update',
  systemUpdate: 'eave:system-update',
  clipboardUpdate: 'eave:clipboard-update',
  settingsUpdate: 'eave:settings-update',
  runtimeUpdate: 'eave:runtime-update',
  mediaCommand: 'eave:media-command',
  volumeCommand: 'eave:volume-command',
  clipboardAction: 'eave:clipboard-action',
  windowAction: 'eave:window-action',
  setInteractive: 'eave:set-interactive',
  setPanel: 'eave:set-panel',
  settingsPatch: 'eave:settings-patch',
  thumbnailProbe: 'eave:thumbnail-probe',
  openExternal: 'eave:open-external',
  skinsAction: 'eave:skins-action',
  skinsUpdate: 'eave:skins-update',
  stashAction: 'eave:stash-action',
  stashUpdate: 'eave:stash-update',
  gameUpdate: 'eave:game-update',
  stashDrop: 'eave:stash-drop'
} as const
