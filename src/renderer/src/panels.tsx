import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ClipboardItem,
  IslandRuntime,
  IslandSettings,
  MediaState,
  SkinDef,
  SystemState,
  ThumbnailSupport
} from '@shared/types'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BatteryIcon,
  ClipboardIcon,
  CloseIcon,
  GaugeIcon,
  IdleIcon,
  ImageIcon,
  MusicIcon,
  NextIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  PowerIcon,
  PrevIcon,
  TrashIcon,
  VolumeIcon
} from './icons'
import {
  appInitial,
  coverPalette,
  formatBytes,
  formatClock,
  formatRate,
  formatRelative,
  heatColor
} from './format'
import { fetchWeather, lunarLabel, weatherCacheFresh, weatherEmoji, type WeatherInfo } from './weather'

export function MediaPanel({
  media,
  onCommand,
  volumeEnabled = false
}: {
  media: MediaState
  onCommand: (action: 'playpause' | 'next' | 'previous') => void
  volumeEnabled?: boolean
}) {
  const [drift, setDrift] = useState(0)

  useEffect(() => {
    setDrift(0)
    if (!media.available || media.status !== 'Playing') return
    const timer = setInterval(() => setDrift((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [media.position, media.status, media.available])

  const palette = useMemo(
    () => coverPalette(`${media.album}|${media.title}|${media.appName}`),
    [media.album, media.title, media.appName]
  )

  if (!media.available) {
    return (
      <div className="panel">
        <div className="empty">
          <MusicIcon />
          <span>暂无正在播放的媒体</span>
          <span style={{ fontSize: 10 }}>打开任意播放器或浏览器音频即可接管</span>
        </div>
      </div>
    )
  }

  const playing = media.status === 'Playing'
  const livePosition = playing ? Math.min(media.duration, media.position + drift) : media.position
  /** 部分播放器（B 站等）不向 SMTC 报进度：duration=0 时比例算不出来，走不确定态 */
  const noTimeline = media.duration <= 0
  const ratio = !noTimeline ? Math.min(1, Math.max(0, livePosition / media.duration)) : 0
  const coverSeed = media.album || media.title || media.appName || 'eave'
  const initial = appInitial(coverSeed)

  return (
    <div className="panel panel--media">
      {media.thumbnail ? (
        <div
          className="aura"
          style={{ backgroundImage: `url(${media.thumbnail})`, opacity: playing ? 0.44 : 0.26 }}
        />
      ) : (
        <div
          className="aura"
          style={{
            background: `linear-gradient(150deg, ${palette.from}, ${palette.to})`,
            opacity: playing ? 0.62 : 0.38
          }}
        />
      )}

      <div className="hero">
        <div className={`cover${playing ? ' cover--live' : ''}`}>
          {media.thumbnail ? (
            <img src={media.thumbnail} alt="" draggable={false} />
          ) : (
            <span
              className="cover__ph"
              style={{ background: `linear-gradient(150deg, ${palette.from}, ${palette.to})` }}
            >
              <span className="cover__ph-text">{initial}</span>
            </span>
          )}
          {playing ? <span className="cover__ring" /> : null}
        </div>
        <div className="hero__meta">
          <div className="hero__title">{media.title || '未知曲目'}</div>
          <div className="hero__artist">{media.artist || '未知艺术家'}</div>
          <div className="hero__source">
            {media.appName}
            {media.album ? ` · ${media.album}` : ''}
          </div>
        </div>
      </div>

      <div className="progress">
        <span className="progress__time">{formatClock(livePosition)}</span>
        <div className="progress__track">
          {noTimeline ? (
            <div className={`progress__fill progress__fill--indet${playing ? '' : ' progress__fill--paused'}`} />
          ) : (
            <div
              className={`progress__fill${playing ? ' progress__fill--live' : ''}`}
              style={{ width: `${ratio * 100}%` }}
            />
          )}
        </div>
        <span className="progress__time progress__time--end">
          {noTimeline ? '--:--' : formatClock(media.duration)}
        </span>
      </div>

      <div className="controls">
        <button
          className="ctrl"
          onClick={() => onCommand('previous')}
          disabled={!media.canPrev}
          title="上一首"
        >
          <PrevIcon />
        </button>
        <button className="ctrl ctrl--main" onClick={() => onCommand('playpause')} title="播放 / 暂停">
          {media.status === 'Playing' ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="ctrl" onClick={() => onCommand('next')} disabled={!media.canNext} title="下一首">
          <NextIcon />
        </button>
      </div>

      {volumeEnabled ? (
        <div className="volume-row">
          <button
            className="vol-btn"
            title="音量 −（媒体键模拟，步进约 2%）"
            onClick={() => window.eave.volumeCommand('down')}
          >
            −
          </button>
          <span className="volume-row__icon">
            <VolumeIcon />
          </span>
          <button
            className="vol-btn"
            title="音量 +（媒体键模拟，步进约 2%）"
            onClick={() => window.eave.volumeCommand('up')}
          >
            +
          </button>
          <button
            className="vol-btn vol-btn--mute"
            title="静音 / 取消静音"
            onClick={() => window.eave.volumeCommand('mute')}
          >
            静音
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Metric({
  label,
  value,
  unit,
  ratio,
  icon,
  hint
}: {
  label: string
  value: string
  unit?: string
  ratio?: number
  icon: ReactNode
  hint?: string
}) {
  return (
    <div className="metric">
      <div className="metric__label">
        <span>{label}</span>
        <span style={{ width: 12, height: 12, display: 'inline-flex' }}>{icon}</span>
      </div>
      <div className="metric__value">
        {value}
        {unit ? <span className="metric__unit">{unit}</span> : null}
      </div>
      {typeof ratio === 'number' ? (
        <div className="bar">
          <div
            className="bar__fill"
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: heatColor(ratio) }}
          />
        </div>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{hint ?? ''}</div>
      )}
    </div>
  )
}

/** 波形采样窗口：40 点 ≈ 40 秒历史，一个 Float64 没多少字节 */
const WAVE_POINTS = 40
const WAVE_W = 100
const WAVE_H = 24

/** 网速归一：对数刻度，50MB/s 顶格。10KB/s 和 0 在视觉上也能拉开差距 */
function normalizeNet(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return 0
  return Math.min(1, Math.log10(1 + bps) / Math.log10(1 + 50e6))
}

/**
 * 迷你波形：SVG polyline，每秒只改一个 points 属性。
 * 不引 canvas、不开 requestAnimationFrame —— 1Hz 更新配 1Hz 重绘足够。
 */
function Wave({ samples }: { samples: number[] }) {
  const step = WAVE_W / (WAVE_POINTS - 1)
  const points = samples
    .map((value, index) => `${(index * step).toFixed(1)},${(WAVE_H - value * WAVE_H).toFixed(1)}`)
    .join(' ')
  const area = `0,${WAVE_H} ${points} ${WAVE_W},${WAVE_H}`
  return (
    <svg
      className="wave"
      viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={area} fill="var(--accent)" opacity="0.16" stroke="none" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** 带历史缓存的指标卡：CPU / 网速共用，缓存只在面板挂载期间累计 */
function WaveMetric({
  label,
  value,
  unit,
  icon,
  sample,
  hint
}: {
  label: string
  value: string
  unit?: string
  icon: ReactNode
  sample: number
  hint?: string
}) {
  const history = useRef<number[]>(new Array(WAVE_POINTS).fill(0))
  const lastSample = useRef(-1)
  if (lastSample.current !== sample) {
    lastSample.current = sample
    history.current.push(sample)
    if (history.current.length > WAVE_POINTS) history.current.shift()
  }
  return (
    <div className="metric metric--wave">
      <div className="metric__label">
        <span>{label}</span>
        <span style={{ width: 12, height: 12, display: 'inline-flex' }}>{icon}</span>
      </div>
      <div className="metric__value">
        {value}
        {unit ? <span className="metric__unit">{unit}</span> : null}
      </div>
      <Wave samples={history.current} />
      {hint ? <div className="metric__hint">{hint}</div> : null}
    </div>
  )
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function SystemPanel({
  system,
  runtime,
  settings
}: {
  system: SystemState
  runtime: IslandRuntime | null
  settings: IslandSettings
}) {
  const memRatio = system.memTotalBytes > 0 ? system.memUsedBytes / system.memTotalBytes : 0
  const battery = system.battery
  const [memValue, memUnit] = formatBytes(system.memUsedBytes, 1).split(' ')
  const uptimeHours = Math.floor(system.uptimeSeconds / 3600)
  const platformLabel = runtime
    ? `${runtime.platform === 'win11' ? 'Windows 11' : 'Windows 10'} · ${runtime.buildNumber}`
    : '检测中'

  const now = new Date()

  // 天气：缓存新鲜直接用；否则拉一次。30 分钟内不重复请求
  const [weather, setWeather] = useState<WeatherInfo | null>(() => weatherCacheFresh(settings.weatherCity))
  const [weatherLoading, setWeatherLoading] = useState(false)

  useEffect(() => {
    if (weatherCacheFresh(settings.weatherCity)) {
      setWeather(weatherCacheFresh(settings.weatherCity))
      return
    }
    let cancelled = false
    setWeatherLoading(true)
    void fetchWeather(settings.weatherCity).then((info) => {
      if (!cancelled) {
        setWeather(info ?? weatherCacheFresh(settings.weatherCity))
        setWeatherLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [settings.weatherCity])

  const refreshWeather = (): void => {
    if (weatherLoading) return
    setWeatherLoading(true)
    void fetchWeather(settings.weatherCity).then((info) => {
      setWeather(info ?? weather)
      setWeatherLoading(false)
    })
  }

  const lunar = lunarLabel(now)
  // 右侧信息并入星期（原 CPU 卡 hint 的内容）；完整日期任务栏已有，不重复占宽
  const weatherMeta = [
    WEEKDAYS[now.getDay()],
    lunar ? `农历${lunar}` : '',
    weather ? `湿度 ${weather.humidity}%` : '',
    weather ? `风 ${weather.windKmph}km/h` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  const weatherText = weather
    ? `${weatherEmoji(weather.desc)} ${weather.tempC}°C ${weather.desc}`
    : weatherLoading
      ? '天气获取中…'
      : '天气 --'

  return (
    <div className="panel">
      <div className="grid">
        <WaveMetric
          label="CPU 占用"
          value={String(system.cpu)}
          unit="%"
          icon={<GaugeIcon />}
          sample={Math.min(1, system.cpu / 100)}
        />
        <Metric label="内存占用" value={memValue} unit={memUnit} ratio={memRatio} icon={<IdleIcon />} />
        <WaveMetric
          label="下载"
          value={formatRate(system.netDownBps)}
          icon={<ArrowDownIcon />}
          sample={normalizeNet(system.netDownBps)}
          hint={platformLabel}
        />
        <Metric
          label="上传"
          value={formatRate(system.netUpBps)}
          icon={<ArrowUpIcon />}
          hint={uptimeHours >= 24 ? `已开机 ${Math.floor(uptimeHours / 24)} 天` : `已开机 ${uptimeHours} 小时`}
        />
      </div>

      <button className={`weather-row${weatherLoading ? ' weather-row--loading' : ''}`} onClick={refreshWeather} title="点击刷新天气">
        <span>{weatherText}</span>
        <span>{weatherMeta}</span>
      </button>

      <div className="row" style={{ paddingTop: 2 }}>
        <span className="row__label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 13, height: 13, display: 'inline-flex' }}>
            <BatteryIcon level={battery.hasBattery ? battery.percent / 100 : 1} />
          </span>
          电池
        </span>
        <span className="row__label" style={{ color: 'var(--text)' }}>
          {battery.hasBattery
            ? `${battery.percent}%${battery.charging ? ' · 充电中' : ''}`
            : battery.charging
              ? '已接通电源'
              : '未检测到电池'}
        </span>
      </div>
    </div>
  )
}

export function ClipboardPanel({
  items,
  query,
  onQuery,
  onAction
}: {
  items: ClipboardItem[]
  query: string
  onQuery: (value: string) => void
  onAction: (action: { type: 'pin' | 'remove' | 'clear' | 'clearAll'; id?: string }) => void
}) {
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.text.toLowerCase().includes(keyword))
  }, [items, query])

  return (
    <div className="panel">
      <div className="clip-toolbar">
        <input
          className="search"
          placeholder="搜索历史记录"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          spellCheck={false}
        />
        <button className="ghost" onClick={() => onAction({ type: 'clear' })} title="清除未固定记录">
          清空
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <ClipboardIcon />
          <span>{items.length === 0 ? '复制任意内容后会出现在这里' : '没有匹配的记录'}</span>
        </div>
      ) : (
        <div className="clip-list">
          {filtered.map((item) => (
            <div className="clip-item" key={item.id} onClick={() => onAction({ type: 'pin', id: item.id })}>
              {item.kind === 'image' && item.imageDataUrl ? (
                <img className="clip-item__thumb" src={item.imageDataUrl} alt="" draggable={false} />
              ) : (
                <span className="clip-item__thumb">
                  <span style={{ width: 13, height: 13, display: 'inline-flex' }}>
                    <ImageIcon />
                  </span>
                </span>
              )}
              <div className="clip-item__body">
                <div className="clip-item__text">{item.preview || '（空）'}</div>
                <div className="clip-item__meta">
                  {formatRelative(item.time)} · {formatBytes(item.sizeBytes, 0)}
                </div>
              </div>
              <div className="clip-item__actions">
                <button
                  className={`icon-btn${item.pinned ? ' icon-btn--on' : ''}`}
                  title={item.pinned ? '取消固定' : '固定'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAction({ type: 'pin', id: item.id })
                  }}
                >
                  <PinIcon />
                </button>
                <button
                  className="icon-btn"
                  title="删除"
                  onClick={(event) => {
                    event.stopPropagation()
                    onAction({ type: 'remove', id: item.id })
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface SettingsPanelProps {
  /** 直接用 shared 的 IslandSettings —— 手抄子集会随字段增加悄悄漂移 */
  settings: IslandSettings
  runtime: IslandRuntime | null
  skins: SkinDef[]
  onPatch: (patch: Record<string, unknown>) => void
  onReset: () => void
  onProbeThumbnail: () => Promise<ThumbnailSupport>
  onSkinsAction: (action: 'import' | 'export' | 'delete', id?: string) => void
}

export function SettingsPanel({
  settings,
  runtime,
  skins,
  onPatch,
  onReset,
  onProbeThumbnail,
  onSkinsAction
}: SettingsPanelProps) {
  const [probing, setProbing] = useState(false)
  const activeSkin = skins.find((skin) => skin.id === settings.activeSkin) ?? null

  const thumbLabel =
    runtime?.thumbnailSupport === 'available'
      ? '可用 · 真实专辑图'
      : runtime?.thumbnailSupport === 'unavailable'
        ? '不可用 · 占位美术'
        : '未检测'

  const runProbe = (): void => {
    if (probing) return
    setProbing(true)
    void onProbeThumbnail().finally(() => setProbing(false))
  }

  return (
    <div className="panel">
      <div className="settings">
        <div className="section-title">外观</div>
        <div className="row">
          <span className="row__label">主题</span>
          <div className="seg">
            <button
              className={`seg__btn${settings.theme === 'dark' ? ' seg__btn--on' : ''}`}
              onClick={() => onPatch({ theme: 'dark' })}
            >
              深色
            </button>
            <button
              className={`seg__btn${settings.theme === 'light' ? ' seg__btn--on' : ''}`}
              onClick={() => onPatch({ theme: 'light' })}
            >
              浅色
            </button>
            <button
              className={`seg__btn${settings.theme === 'auto' ? ' seg__btn--on' : ''}`}
              onClick={() => onPatch({ theme: 'auto' })}
            >
              自动
            </button>
          </div>
        </div>
        <div className="row">
          <span className="row__label">强调色</span>
          <input
            type="color"
            value={settings.accent}
            onChange={(event) => onPatch({ accent: event.target.value })}
            style={{
              width: 40,
              height: 22,
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              cursor: 'pointer'
            }}
          />
        </div>

        <div className="row row--stack">
          <span className="row__label">皮肤</span>
          <div className="skin-grid">
            <button
              className={`skin-card${!settings.activeSkin ? ' skin-card--on' : ''}`}
              onClick={() => onPatch({ activeSkin: '' })}
            >
              <span
                className="skin-card__preview"
                style={{ background: 'linear-gradient(135deg, #0a84ff, #101014)' }}
              />
              <span>默认</span>
            </button>
            {skins.map((skin) => (
              <button
                key={skin.id}
                className={`skin-card${settings.activeSkin === skin.id ? ' skin-card--on' : ''}`}
                onClick={() => onPatch({ activeSkin: skin.id })}
                title={skin.name}
              >
                <span
                  className="skin-card__preview"
                  style={{ background: `linear-gradient(135deg, ${skin.dark.accent}, ${skin.dark.bg})` }}
                />
                <span>{skin.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="row__label">
            皮肤管理
            <span className="row__sub">导出/删除作用于当前激活的皮肤</span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={() => onSkinsAction('import')}>
              导入
            </button>
            <button
              className="ghost"
              disabled={!settings.activeSkin || settings.activeSkin.startsWith('builtin:')}
              onClick={() => onSkinsAction('export', settings.activeSkin)}
            >
              导出
            </button>
            <button
              className="ghost"
              disabled={!settings.activeSkin || settings.activeSkin.startsWith('builtin:')}
              onClick={() => onSkinsAction('delete', settings.activeSkin)}
            >
              删除
            </button>
          </span>
        </div>
        <div className="row">
          <span className="row__label">
            皮肤背景图
            <span className="row__sub">随皮肤文件自带</span>
          </span>
          <span className="row__value">{activeSkin?.bgImage ? '有' : '无'}</span>
        </div>
        <div className="row">
          <span className="row__label">
            岛内住客
            <span className="row__sub">胶囊旁的二次元小人</span>
          </span>
          <button
            className={`switch${settings.companionEnabled ? ' switch--on' : ''}`}
            onClick={() => onPatch({ companionEnabled: !settings.companionEnabled })}
            aria-label="切换岛内住客"
          />
        </div>
        <div className="row">
          <span className="row__label">
            强调色跟随封面
            <span className="row__sub">播放时从专辑图提取主色</span>
          </span>
          <button
            className={`switch${settings.accentFromCover ? ' switch--on' : ''}`}
            onClick={() => onPatch({ accentFromCover: !settings.accentFromCover })}
            aria-label="切换强调色跟随封面"
          />
        </div>
        <div className="row">
          <span className="row__label">不透明度</span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={settings.opacity}
            onChange={(event) => onPatch({ opacity: Number(event.target.value) })}
          />
          <span className="row__value">{Math.round(settings.opacity * 100)}%</span>
        </div>
        <div className="row">
          <span className="row__label">顶部间距</span>
          <input
            type="range"
            min={0}
            max={80}
            step={1}
            value={settings.topOffset}
            onChange={(event) => onPatch({ topOffset: Number(event.target.value) })}
          />
          <span className="row__value">{settings.topOffset}px</span>
        </div>

        <div className="section-title">行为</div>
        <div className="row">
          <span className="row__label">常驻显示时钟</span>
          <button
            className={`switch${settings.idleClock ? ' switch--on' : ''}`}
            onClick={() => onPatch({ idleClock: !settings.idleClock })}
            aria-label="切换常驻时钟"
          />
        </div>
        <div className="row">
          <span className="row__label">投影</span>
          <button
            className={`switch${settings.shadow ? ' switch--on' : ''}`}
            onClick={() => onPatch({ shadow: !settings.shadow })}
            aria-label="切换投影"
          />
        </div>
        <div className="row">
          <span className="row__label">提示音</span>
          <button
            className={`switch${settings.soundEnabled ? ' switch--on' : ''}`}
            onClick={() => onPatch({ soundEnabled: !settings.soundEnabled })}
            aria-label="切换提示音"
          />
        </div>
        <div className="row">
          <span className="row__label">天气城市</span>
          <input
            className="search search--inline"
            placeholder="留空按 IP 定位，如：上海"
            value={settings.weatherCity}
            onChange={(event) => onPatch({ weatherCity: event.target.value })}
            spellCheck={false}
          />
        </div>
        <div className="row">
          <span className="row__label">
            游戏迷你条
            <span className="row__sub">前台全屏时自动切换</span>
          </span>
          <button
            className={`switch${settings.gameMode ? ' switch--on' : ''}`}
            onClick={() => onPatch({ gameMode: !settings.gameMode })}
            aria-label="切换游戏迷你条"
          />
        </div>
        {settings.gameMode ? (
          <div className="row row--stack">
            <span className="row__label">排除名单（每行一个 exe 名）</span>
            <textarea
              className="exclude-area"
              value={settings.gameExclude.join('\n')}
              onChange={(event) =>
                onPatch({
                  gameExclude: event.target.value
                    .split(/\r?\n/)
                    .map((line) => line.trim().toLowerCase())
                    .filter(Boolean)
                })
              }
              spellCheck={false}
              rows={4}
            />
          </div>
        ) : null}
        <div className="row">
          <span className="row__label">动效强度</span>
          <div className="seg">
            <button
              className={`seg__btn${settings.motion === 'full' ? ' seg__btn--on' : ''}`}
              onClick={() => onPatch({ motion: 'full' })}
            >
              完整
            </button>
            <button
              className={`seg__btn${settings.motion === 'calm' ? ' seg__btn--on' : ''}`}
              onClick={() => onPatch({ motion: 'calm' })}
            >
              省电
            </button>
          </div>
        </div>
        <div className="row">
          <span className="row__label">歌曲封面</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="row__value" style={{ minWidth: 0 }}>
              {thumbLabel}
            </span>
            <button className="ghost" onClick={runProbe} disabled={probing}>
              {probing ? '检测中' : '自检'}
            </button>
          </span>
        </div>
        <div className="row">
          <span className="row__label">始终置顶</span>
          <button
            className={`switch${settings.alwaysOnTop ? ' switch--on' : ''}`}
            onClick={() => onPatch({ alwaysOnTop: !settings.alwaysOnTop })}
            aria-label="切换始终置顶"
          />
        </div>
        <div className="row">
          <span className="row__label">开机自启</span>
          <button
            className={`switch${settings.autoStart ? ' switch--on' : ''}`}
            onClick={() => onPatch({ autoStart: !settings.autoStart })}
            aria-label="切换开机自启"
          />
        </div>
        <div className="row">
          <span className="row__label">记录剪贴板</span>
          <button
            className={`switch${settings.clipboardEnabled ? ' switch--on' : ''}`}
            onClick={() => onPatch({ clipboardEnabled: !settings.clipboardEnabled })}
            aria-label="切换剪贴板记录"
          />
        </div>

        <div className="section-title">模块</div>
        <div className="row">
          <span className="row__label">媒体控制</span>
          <button
            className={`switch${settings.modules.media ? ' switch--on' : ''}`}
            onClick={() => onPatch({ modules: { ...settings.modules, media: !settings.modules.media } })}
            aria-label="切换媒体模块"
          />
        </div>
        <div className="row">
          <span className="row__label">系统状态</span>
          <button
            className={`switch${settings.modules.system ? ' switch--on' : ''}`}
            onClick={() => onPatch({ modules: { ...settings.modules, system: !settings.modules.system } })}
            aria-label="切换系统模块"
          />
        </div>
        <div className="row">
          <span className="row__label">剪贴板历史</span>
          <button
            className={`switch${settings.modules.clipboard ? ' switch--on' : ''}`}
            onClick={() =>
              onPatch({ modules: { ...settings.modules, clipboard: !settings.modules.clipboard } })
            }
            aria-label="切换剪贴板模块"
          />
        </div>

        <div className="footer-note">
          <span>
            {runtime
              ? `${runtime.platform === 'win11' ? 'Windows 11' : 'Windows 10'} build ${runtime.buildNumber}`
              : '检测中'}
          </span>
          <span style={{ display: 'flex', gap: 10 }}>
            <a onClick={() => onPatch({ __openSettingsFile: true })}>配置文件</a>
            <a onClick={onReset}>恢复默认</a>
          </span>
        </div>
      </div>
    </div>
  )
}

export { CloseIcon, PowerIcon }
