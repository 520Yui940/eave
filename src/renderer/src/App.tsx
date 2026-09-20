import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { EMPTY_MEDIA } from '@shared/types'
import type {
  BridgeState,
  ClipboardItem,
  GameModeState,
  IslandRuntime,
  IslandSettings,
  MediaState,
  PanelKind,
  SkinDef,
  StashEntry,
  SystemState,
  ThumbnailSupport
} from '@shared/types'
import { ClipboardPanel, MediaPanel, SettingsPanel, SystemPanel } from './panels'
import { TimersPanel } from './timers-panel'
import { ToolsPanel } from './tools-panel'
import { StashPanel, type StashActionType } from './stash-panel'
import { Companion, useCompanion } from './companion'
import {
  BoxIcon,
  ClipboardIcon,
  CloseIcon,
  GaugeIcon,
  MusicIcon,
  PinIcon,
  SettingsIcon,
  TimerIcon,
  WrenchIcon
} from './icons'
import { accentFromCover } from './color'
import {
  clearExpired,
  formatTimer,
  isRunning,
  playChime,
  remainingMs,
  useActiveTimer,
  useTimers
} from './timers'

const EMPTY_SYSTEM: SystemState = {
  cpu: 0,
  gpu: 0,
  memUsedBytes: 0,
  memTotalBytes: 0,
  netDownBps: 0,
  netUpBps: 0,
  battery: { hasBattery: false, percent: -1, charging: false },
  uptimeSeconds: 0
}

const FALLBACK_SETTINGS: IslandSettings = {
  theme: 'dark',
  accent: '#0a84ff',
  accentFromCover: true,
  opacity: 0.97,
  scale: 1,
  topOffset: 6,
  hideOnFullscreen: false,
  alwaysOnTop: true,
  autoStart: false,
  clipboardEnabled: true,
  clipboardLimit: 60,
  idleClock: true,
  motion: 'full',
  shadow: true,
  soundEnabled: true,
  weatherCity: '',
  activeSkin: '',
  gameMode: true,
  gameExclude: ['explorer.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe'],
  companionEnabled: true,
  modules: { media: true, system: true, clipboard: true, volume: true }
}

const PANEL_CLASS: Record<PanelKind, string> = {
  idle: 'island--pill',
  media: 'island--media',
  system: 'island--system',
  clipboard: 'island--clipboard',
  timers: 'island--timers',
  tools: 'island--tools',
  stash: 'island--stash',
  settings: 'island--settings'
}

function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 深夜时段（23:00~06:59）胶囊自动转暗，靠 CSS 过渡，不加任何新进程/定时器 */
function isNightHour(date: Date): boolean {
  const hour = date.getHours()
  return hour >= 23 || hour < 7
}

export default function App() {
  const [media, setMedia] = useState<MediaState>(EMPTY_MEDIA)
  const [system, setSystem] = useState<SystemState>(EMPTY_SYSTEM)
  const [clipboard, setClipboard] = useState<ClipboardItem[]>([])
  const [stash, setStash] = useState<StashEntry[]>([])
  const [skins, setSkins] = useState<SkinDef[]>([])
  const [game, setGame] = useState<GameModeState>({ active: false, exeName: '', startedAt: 0 })
  const [settings, setSettings] = useState<IslandSettings>(FALLBACK_SETTINGS)
  const [runtime, setRuntime] = useState<IslandRuntime | null>(null)
  const [panel, setPanel] = useState<PanelKind>('idle')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [clock, setClock] = useState(() => clockLabel(new Date()))
  const [night, setNight] = useState(() => isNightHour(new Date()))
  /** 封面取色结果；空串表示未启用/未取到，回退 settings.accent */
  const [coverAccent, setCoverAccent] = useState('')
  /** 新剪贴板条目到达时的胶囊呼吸提示 */
  const [clipPulse, setClipPulse] = useState(false)

  const interactiveRef = useRef(false)
  const hoverRef = useRef(false)
  const lastPanelRef = useRef<PanelKind>('media')
  /** 钉住：鼠标移出岛体不再收起，输入类面板（工具箱/暂存）的命脉 */
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned
  /** 游戏进行中：胶囊变迷你条，悬停不展开面板 */
  const gameActive = game.active && settings.gameMode
  const gameActiveRef = useRef(false)
  gameActiveRef.current = gameActive

  const mediaRef = useRef(media)
  mediaRef.current = media
  const modulesRef = useRef(settings.modules)
  modulesRef.current = settings.modules
  const clipboardLenRef = useRef(0)

  // 计时器：胶囊态直接上倒计时；归零事件转 toast + 呼吸点
  const activeTimer = useActiveTimer()
  const { expired } = useTimers()
  const [timerPulse, setTimerPulse] = useState(false)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1800)
  }, [])

  // 时钟：每秒对一次，只在分钟变化时写状态，避免多余 re-render
  // 同一 tick 顺带算夜间标记（值不变不触发渲染）
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date()
      const label = clockLabel(now)
      setClock((prev) => (prev === label ? prev : label))
      setNight((prev) => (prev === isNightHour(now) ? prev : isNightHour(now)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const defaultPanel = useCallback((): PanelKind => {
    const modules = modulesRef.current
    if (modules.media && mediaRef.current.available) return 'media'
    if (modules.system) return 'system'
    if (modules.clipboard) return 'clipboard'
    return 'settings'
  }, [])

  useEffect(() => {
    let mounted = true
    window.eave
      .snapshot()
      .then((state: BridgeState) => {
        if (!mounted) return
        setMedia(state.media)
        setSystem(state.system)
        setClipboard(state.clipboard)
        setStash(state.stash)
        setSettings(state.settings)
        setRuntime(state.runtime)
      })
      .catch(() => undefined)
    void window.eave.skinsList().then((list) => {
      if (mounted) setSkins(list)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const unsubscribe = [
      window.eave.onMedia(setMedia),
      window.eave.onSystem(setSystem),
      window.eave.onClipboard(setClipboard),
      window.eave.onStash(setStash),
      window.eave.onSkins(setSkins),
      window.eave.onGame(setGame),
      window.eave.onSettings(setSettings),
      window.eave.onRuntime(setRuntime),
      window.eave.onPanel((next) => {
        lastPanelRef.current = next
        hoverRef.current = true
        setPanel(next)
        window.eave.setInteractive(true)
      })
    ]
    return () => unsubscribe.forEach((off) => off())
  }, [])

  // 新剪贴板条目 → 胶囊呼吸点提示（仅在常驻态展示，展开态不抢戏）
  useEffect(() => {
    const prev = clipboardLenRef.current
    clipboardLenRef.current = clipboard.length
    if (clipboard.length > prev && panel === 'idle') {
      setClipPulse(true)
      const timer = window.setTimeout(() => setClipPulse(false), 1600)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [clipboard.length, panel])

  // 计时器/番茄钟归零 → 提示音（按设置）+ toast + 胶囊闪烁
  useEffect(() => {
    if (!expired) return
    if (settings.soundEnabled) playChime()
    setTimerPulse(true)
    showToast(expired.kind === 'pomodoro' ? `番茄钟：${expired.label} 阶段结束` : `${expired.label} 时间到`)
    clearExpired()
    const timer = window.setTimeout(() => setTimerPulse(false), 2400)
    return () => window.clearTimeout(timer)
  }, [expired, settings.soundEnabled, showToast])

  // 主题 auto：跟随系统深浅色，matchMedia 变化时才会触发重渲染
  const systemPrefersDark = useMemo(
    () => window.matchMedia('(prefers-color-scheme: dark)'),
    []
  )
  const [sysDark, setSysDark] = useState(systemPrefersDark.matches)
  useEffect(() => {
    const onChange = (event: MediaQueryListEvent): void => setSysDark(event.matches)
    systemPrefersDark.addEventListener('change', onChange)
    return () => systemPrefersDark.removeEventListener('change', onChange)
  }, [systemPrefersDark])
  const lightTheme = settings.theme === 'light' || (settings.theme === 'auto' && !sysDark)

  // 强调色跟随封面：只在曲目封面变化时取一次色，结果走 color.ts 缓存
  useEffect(() => {
    if (!settings.accentFromCover || !media.available || !media.thumbnailReal || !media.thumbnail) {
      setCoverAccent('')
      return
    }
    let cancelled = false
    void accentFromCover(media.thumbnail).then((color) => {
      if (!cancelled && color) setCoverAccent(color)
    })
    return () => {
      cancelled = true
    }
  }, [settings.accentFromCover, media.available, media.thumbnailReal, media.thumbnail])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
      const surface = el?.closest('[data-eave-surface]')
      const companionEl = el?.closest('[data-eave-companion]')
      const inside = Boolean(surface)
      // 小人也算交互区（否则穿透状态下点不到她），但 hover 她不触发展开
      const touching = inside || Boolean(companionEl)
      if (touching !== interactiveRef.current) {
        interactiveRef.current = touching
        window.eave.setInteractive(touching)
      }
      // 钉住或游戏中：只维护 interactive，面板保持不动——鼠标移出再回来，现场原样
      if (pinnedRef.current || gameActiveRef.current) {
        hoverRef.current = inside
        return
      }
      if (inside !== hoverRef.current) {
        hoverRef.current = inside
        setPanel(inside ? defaultPanel() : 'idle')
      }
    }

    const onLeave = () => {
      if (interactiveRef.current) {
        interactiveRef.current = false
        window.eave.setInteractive(false)
      }
      // 钉住/游戏中不收起；interactive 已关，光标回岛体时 forward 模式会自动恢复
      if (pinnedRef.current || gameActiveRef.current) return
      if (hoverRef.current) {
        hoverRef.current = false
        setPanel('idle')
      }
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [defaultPanel])

  // 钉住时 Esc 解钉（窗口在键盘面板下是 focusable 的）
  useEffect(() => {
    if (!pinned) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinned(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned])

  useEffect(() => {
    const needsKeyboard =
      panel === 'settings' || panel === 'clipboard' || panel === 'tools' || panel === 'stash'
    if (interactiveRef.current) window.eave.setInteractive(true, needsKeyboard)
  }, [panel, pinned])

  const selectPanel = useCallback((next: PanelKind) => {
    lastPanelRef.current = next
    setPanel(next)
  }, [])

  const onCommand = useCallback((action: 'playpause' | 'next' | 'previous') => {
    window.eave.mediaCommand({ action })
  }, [])

  const onClipboardAction = useCallback(
    (action: { type: 'pin' | 'remove' | 'clear' | 'clearAll'; id?: string }) => {
      window.eave.clipboardAction(action)
    },
    []
  )

  const onStashAction = useCallback(
    async (action: { type: StashActionType; id?: string }) => {
      const result = await window.eave.stashAction(action)
      if (!result.ok && result.error) showToast(result.error)
      else if (action.type === 'copyPath') showToast('路径已复制')
      else if (action.type === 'clear') showToast('已清空暂存架')
      // 列表刷新走 stashUpdate 事件
    },
    [showToast]
  )

  /** 岛体拖放区：面板展开（interactive）时 drop 才能收到——穿透窗口收不到拖放事件 */
  const onIslandDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onIslandDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => window.eave.filePath(file))
        .filter(Boolean)
      if (paths.length === 0) {
        showToast('没识别到本地文件')
        return
      }
      void window.eave.stashAction({ type: 'add', paths }).then((result) => {
        if (result.ok) showToast(result.error || `已暂存 ${paths.length} 项`)
        else showToast(result.error || '暂存失败')
      })
      // 拖入即跳到暂存面板看结果
      lastPanelRef.current = 'stash'
      hoverRef.current = true
      setPanel('stash')
      window.eave.setInteractive(true, true)
    },
    [showToast]
  )

  const onPatch = useCallback((patch: Record<string, unknown>) => {
    if (patch.__openSettingsFile) {
      window.eave.windowAction('settings-file')
      return
    }
    window.eave.patchSettings(patch as Partial<IslandSettings>)
    setSettings((prev) => ({ ...prev, ...(patch as Partial<IslandSettings>) }))
  }, [])

  const onProbeThumbnail = useCallback(async (): Promise<ThumbnailSupport> => {
    const result = await window.eave.probeThumbnail()
    showToast(
      result === 'available' ? '封面抓取可用，已启用真实专辑图' : '本机拿不到封面，继续用占位美术'
    )
    return result
  }, [showToast])

  const onSkinsUiAction = useCallback(
    (action: 'import' | 'export' | 'delete', id?: string) => {
      void window.eave.skinsAction(action, id).then((result) => {
        if (!result.ok && result.error) showToast(result.error)
        else if (action === 'import') showToast('皮肤已导入')
        else if (action === 'export') showToast('皮肤已导出')
        else if (action === 'delete') showToast('皮肤已删除')
        // 列表刷新走 skinsUpdate 事件
      })
    },
    [showToast]
  )

  const onReset = useCallback(() => {
    window.eave.patchSettings({ ...FALLBACK_SETTINGS })
    setSettings({ ...FALLBACK_SETTINGS, modules: { ...FALLBACK_SETTINGS.modules } })
    showToast('已恢复默认设置')
  }, [showToast])

  /* ---- 皮肤引擎：激活皮肤的调色板以内联变量压过 :root 与主题类 ---- */
  const activeSkin = useMemo(
    () => skins.find((skin) => skin.id === settings.activeSkin) ?? null,
    [skins, settings.activeSkin]
  )
  const skinVariant = activeSkin
    ? lightTheme
      ? activeSkin.light
      : night
        ? activeSkin.night
        : activeSkin.dark
    : null

  const accent = coverAccent || skinVariant?.accent || settings.accent

  /**
   * 底色三态：浅色主题 / 深夜档 / 常规深色。
   * --island-bg 是内联变量，切换靠 React 侧换值 + CSS transition 平滑过渡。
   * 皮肤激活时底色完全由皮肤接管（皮肤自带透明度，不与设置里的不透明度叠加）。
   */
  const islandBg = skinVariant
    ? skinVariant.bg
    : lightTheme
      ? `rgba(246, 247, 250, ${settings.opacity})`
      : night
        ? `rgba(4, 4, 6, ${settings.opacity})`
        : `rgba(8, 8, 10, ${settings.opacity})`

  const stageStyle = useMemo(() => {
    const style: Record<string, string> = {
      '--accent': accent,
      '--island-bg': islandBg
    }
    if (skinVariant) {
      style['--island-raised'] = skinVariant.raised
      style['--island-sunken'] = skinVariant.sunken
      style['--text'] = skinVariant.text
      style['--text-dim'] = skinVariant.textDim
      style['--text-faint'] = skinVariant.textFaint
      style['--hairline'] = skinVariant.hairline
    }
    return style as CSSProperties
  }, [accent, islandBg, skinVariant])

  const mediaPill = media.available
  const timerOnPill = activeTimer !== null

  // 岛内住客：心情由事件推导，展开态淡出躲开
  const companion = useCompanion({
    mediaPlaying: mediaPill && media.status === 'Playing',
    charging: system.battery.charging,
    night,
    timerPulse,
    clipPulse
  })
  /** 分裂胶囊：媒体 + （计时器 或 时钟）左右同显 */
  const splitPill = mediaPill && panel === 'idle' && (timerOnPill || settings.idleClock)
  /** 游戏迷你条优先级最高：全屏游戏时其他形态全部让位 */
  const pillClass = gameActive
    ? 'island--pill island--pill--game'
    : splitPill
      ? 'island--pill island--pill--split'
      : PANEL_CLASS[panel]

  const elapsedSeconds = gameActive ? Math.max(0, Math.floor((Date.now() - game.startedAt) / 1000)) : 0
  const gameElapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(
    elapsedSeconds % 60
  ).padStart(2, '0')}`

  const pillLeft = mediaPill ? (
    <>
      {media.thumbnail ? (
        <img className="pill__art" src={media.thumbnail} alt="" draggable={false} />
      ) : (
        <div className={`pill__bars${media.status === 'Playing' ? '' : ' pill__bars--paused'}`}>
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="pill__primary">{media.title || '正在播放'}</div>
    </>
  ) : null

  const pillAux = timerOnPill ? (
    <>
      <span
        className={`pill__timer${
          activeTimer.kind === 'pomodoro' && activeTimer.phase === 'break' ? ' pill__timer--break' : ''
        }`}
      >
        {activeTimer.kind === 'pomodoro' ? (activeTimer.phase === 'work' ? '🍅 ' : '☕ ') : ''}
        {formatTimer(remainingMs(activeTimer))}
      </span>
      {!isRunning(activeTimer) ? <span className="pill__aux-label">暂停</span> : null}
    </>
  ) : (
    <span className="pill__clock pill__clock--mini">{clock}</span>
  )

  const pillContent = gameActive ? (
    <div className="pill__game">
      <span className="pill__game-badge">🎮</span>
      <span className="pill__game-cell">CPU {system.cpu}%</span>
      <span className="pill__game-cell">
        GPU {system.gpu >= 0 ? `${Math.round(system.gpu)}%` : '--'}
      </span>
      <span className="pill__game-cell pill__game-cell--time">{gameElapsed}</span>
    </div>
  ) : splitPill ? (
    <>
      <div className="pill__half">{pillLeft}</div>
      <div className="pill__divider" />
      <div className="pill__half pill__half--aux">{pillAux}</div>
    </>
  ) : mediaPill ? (
    <>
      {pillLeft}
      <div className="pill__secondary">{media.artist || media.appName}</div>
    </>
  ) : timerOnPill ? (
    <>
      <span
        className={`pill__timer pill__timer--solo${
          activeTimer.kind === 'pomodoro' && activeTimer.phase === 'break' ? ' pill__timer--break' : ''
        }`}
      >
        {activeTimer.kind === 'pomodoro' ? (activeTimer.phase === 'work' ? '🍅 ' : '☕ ') : ''}
        {formatTimer(remainingMs(activeTimer))}
      </span>
      <span className="pill__secondary">{activeTimer.label}</span>
    </>
  ) : settings.idleClock ? (
    <div className="pill__clock">{clock}</div>
  ) : (
    <div className="pill__dot pill__dot--idle" />
  )

  const stageClass = [
    'stage',
    lightTheme ? 'stage--light' : '',
    settings.motion === 'calm' ? 'stage--calm' : '',
    settings.shadow ? '' : 'stage--noshadow',
    night && lightTheme === false ? 'stage--night' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={stageClass} style={stageStyle}>
      {/* 封面光斑 + 光尘：媒体在播时才渲染，全部是 opacity/transform 动画 */}
      {mediaPill && settings.motion === 'full' ? (
        <>
          <div className="glow" style={{ '--glow-color': accent } as CSSProperties} />
          <div className="dust" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <span key={index} style={{ '--i': index } as CSSProperties} />
            ))}
          </div>
        </>
      ) : null}

      <div className={`island ${pillClass}`} data-eave-surface
        onDragOver={onIslandDragOver}
        onDrop={onIslandDrop}
      >
        {/* 皮肤背景图层：模糊图 + 暗化层，都在岛体圆角内（island overflow:hidden） */}
        {activeSkin?.bgImage ? (
          <>
            <div
              className="island__bgimg"
              style={{
                backgroundImage: `url("${activeSkin.bgImage}")`,
                filter: `blur(${activeSkin.bgBlur}px)`,
                opacity: activeSkin.bgOpacity
              }}
            />
            {activeSkin.bgDim > 0 ? (
              <div className="island__bgdim" style={{ opacity: activeSkin.bgDim }} />
            ) : null}
          </>
        ) : null}
        <div
          className={`pill${mediaPill || timerOnPill ? '' : ' pill--idle'}`}
          onClick={() => selectPanel(lastPanelRef.current)}
        >
          {pillContent}
          {clipPulse || timerPulse ? <span className="pill__pulse" /> : null}
          {system.battery.charging && !mediaPill && !timerOnPill ? (
            <span className="pill__bolt" title="充电中" />
          ) : null}
        </div>

        {panel !== 'idle' ? (
          <div className="body">
            <div className="tabs">
              <button
                className={`tab${panel === 'media' ? ' tab--active' : ''}`}
                onClick={() => selectPanel('media')}
                title="媒体播放"
              >
                <MusicIcon />
              </button>
              <button
                className={`tab${panel === 'system' ? ' tab--active' : ''}`}
                onClick={() => selectPanel('system')}
                title="系统状态"
              >
                <GaugeIcon />
              </button>
              <button
                className={`tab${panel === 'clipboard' ? ' tab--active' : ''}`}
                onClick={() => selectPanel('clipboard')}
                title="剪贴板历史"
              >
                <ClipboardIcon />
              </button>
              <button
                className={`tab${panel === 'timers' ? ' tab--active' : ''}`}
                onClick={() => selectPanel('timers')}
                title="计时器 / 番茄钟"
              >
                <TimerIcon />
              </button>
              <button
                className={`tab${panel === 'tools' ? ' tab--active' : ''}`}
                onClick={() => selectPanel('tools')}
                title="开发工具箱"
              >
                <WrenchIcon />
              </button>
              <button
                className={`tab${panel === 'stash' ? ' tab--active' : ''}`}
                onClick={() => selectPanel('stash')}
                title="文件暂存"
              >
                <BoxIcon />
              </button>
              <button
                className={`tab${panel === 'settings' ? ' tab--active' : ''}`}
                onClick={() => selectPanel('settings')}
                title="设置"
              >
                <SettingsIcon />
              </button>
              <div className="tabs__spacer" />
              <button
                className={`tab${pinned ? ' tab--pinned' : ''}`}
                onClick={() => setPinned((prev) => !prev)}
                title={pinned ? '取消钉住（Esc）' : '钉住：移开鼠标不收起'}
              >
                <PinIcon />
              </button>
              <button
                className="tab"
                onClick={() => {
                  setPinned(false)
                  window.eave.windowAction('hide')
                }}
                title="收起"
              >
                <CloseIcon />
              </button>
            </div>

            {panel === 'media' ? (
              <MediaPanel media={media} onCommand={onCommand} volumeEnabled={settings.modules.volume} />
            ) : null}
            {panel === 'system' ? (
              <SystemPanel system={system} runtime={runtime} settings={settings} />
            ) : null}
            {panel === 'clipboard' ? (
              <ClipboardPanel
                items={clipboard}
                query={query}
                onQuery={setQuery}
                onAction={onClipboardAction}
              />
            ) : null}
            {panel === 'timers' ? <TimersPanel /> : null}
            {panel === 'tools' ? <ToolsPanel onToast={showToast} /> : null}
            {panel === 'stash' ? <StashPanel entries={stash} onAction={onStashAction} /> : null}
            {panel === 'settings' ? (
              <SettingsPanel
                settings={settings}
                runtime={runtime}
                skins={skins}
                onPatch={onPatch}
                onReset={onReset}
                onProbeThumbnail={onProbeThumbnail}
                onSkinsAction={onSkinsUiAction}
              />
            ) : null}

            {toast ? <div className="toast">{toast}</div> : null}
          </div>
        ) : null}
      </div>

      {/* 岛内住客：胶囊态常驻，展开态淡出躲开；媒体胶囊拉宽时换到左侧 */}
      {settings.companionEnabled ? (
        <Companion
          mood={companion.mood}
          blinking={companion.blinking}
          patKey={companion.patKey}
          onPat={companion.onPat}
          hidden={panel !== 'idle'}
          leftSide={mediaPill && panel === 'idle'}
        />
      ) : null}
    </div>
  )
}
