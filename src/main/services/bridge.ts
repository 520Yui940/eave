import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { EMPTY_MEDIA } from '../../shared/types'
import type { MediaState } from '../../shared/types'

export { EMPTY_MEDIA }

const APP_LABELS: Array<[RegExp, string]> = [
  [/chrome/i, 'Chrome'],
  [/msedge/i, 'Edge'],
  [/firefox/i, 'Firefox'],
  [/brave/i, 'Brave'],
  [/spotify/i, 'Spotify'],
  [/cloudmusic|netease/i, '网易云音乐'],
  [/qqmusic/i, 'QQ 音乐'],
  [/kugou/i, '酷狗音乐'],
  [/kuwo/i, '酷我音乐'],
  [/potplayer/i, 'PotPlayer'],
  [/vlc/i, 'VLC'],
  [/foobar/i, 'foobar2000'],
  [/zunemusic|mediaplayer|music\.ui/i, '媒体播放器'],
  [/bilibili/i, '哔哩哔哩'],
  [/iqiyi/i, '爱奇艺'],
  [/tencentvideo|qqlive/i, '腾讯视频'],
  [/youtube/i, 'YouTube'],
  [/aimp/i, 'AIMP'],
  [/mpc-hc|mpc-be/i, 'MPC'],
  [/xboxgamingoverlay|xbox/i, 'Xbox Game Bar'],
  [/windowsmediaplayer/i, 'Windows Media Player'],
  [/groove/i, 'Groove 音乐'],
  [/microsoftvideo|films|movies/i, '电影和电视'],
  [/whatsapp/i, 'WhatsApp'],
  [/telegram/i, 'Telegram'],
  [/discord/i, 'Discord'],
  [/wechat|weixin/i, '微信'],
  [/qq\.exe|tencent.*qq/i, 'QQ'],
  [/steam/i, 'Steam']
]

/**
 * SMTC 给的往往是 AMUID（`Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App`），
 * 直接显示会很难看，先做一次通用清洗再查表。
 */
export function friendlyAppName(sourceAppId: string): string {
  if (!sourceAppId) return ''
  for (const [pattern, label] of APP_LABELS) {
    if (pattern.test(sourceAppId)) return label
  }
  let name = sourceAppId.split('!')[0]
  name = name.replace(/_\w{8,20}$/, '')
  name = name.replace(/\.exe$/i, '')
  name = name.replace(/^Microsoft\./i, '')
  const dot = name.lastIndexOf('.')
  if (dot > 0 && dot < name.length - 1) name = name.slice(dot + 1)
  return name || sourceAppId
}

export function resolvePowerShell(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const absolute = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(absolute) ? absolute : 'powershell.exe'
}

export interface NetRate {
  downBps: number
  upBps: number
}

export interface BridgeHandlers {
  onMedia: (state: MediaState) => void
  onNet: (rate: NetRate) => void
  onHealthChange: (healthy: boolean, detail: string) => void
  onLog?: (message: string) => void
}

export class EaveBridge {
  private child: ChildProcess | null = null
  private buffer = ''
  private stderrTail = ''
  private failures = 0
  private healthy = false
  private detail = 'idle'
  private disposed = false
  private paused = false
  private restartTimer: NodeJS.Timeout | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private media: MediaState = { ...EMPTY_MEDIA }

  constructor(
    private readonly scriptPath: string,
    private readonly handlers: BridgeHandlers
  ) {}

  get isHealthy(): boolean {
    return this.healthy
  }

  get lastMedia(): MediaState {
    return this.media
  }

  start(): void {
    if (this.disposed || this.child) return
    this.paused = false
    this.launch()
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    if (paused) {
      this.handlers.onLog?.('bridge: paused (window hidden)')
      this.killChild()
      this.setHealth(false, 'paused')
    } else if (!this.disposed) {
      this.handlers.onLog?.('bridge: resuming')
      this.failures = 0
      this.launch()
    }
  }

  private log(message: string): void {
    this.handlers.onLog?.(message)
  }

  private setHealth(healthy: boolean, detail: string): void {
    const changed = this.healthy !== healthy || this.detail !== detail
    this.healthy = healthy
    this.detail = detail
    if (changed) this.handlers.onHealthChange(healthy, detail)
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    this.buffer = ''
    if (!child) return
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }

  private launch(): void {
    if (this.disposed || this.paused || this.child) return
    if (!existsSync(this.scriptPath)) {
      this.setHealth(false, `bridge script missing: ${this.scriptPath}`)
      this.log(`bridge: script not found at ${this.scriptPath}`)
      return
    }

    let child: ChildProcess
    try {
      child = spawn(
        resolvePowerShell(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (error) {
      this.scheduleRestart(`spawn failed: ${String(error)}`)
      return
    }

    this.child = child
    this.buffer = ''
    this.stderrTail = ''

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.consume(chunk))

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-1200)
    })

    child.on('error', (error) => this.log(`bridge: process error ${String(error)}`))

    child.on('exit', (code, signal) => {
      this.child = null
      if (this.disposed || this.paused) return
      this.scheduleRestart(`bridge exited code=${code} signal=${signal} ${this.stderrTail.trim()}`.trim())
    })

    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = setTimeout(() => {
      if (!this.healthy && !this.disposed && !this.paused) {
        this.setHealth(false, 'bridge did not report ready in time')
      }
    }, 20000)
    this.readyTimer.unref?.()
  }

  private scheduleRestart(detail: string): void {
    this.setHealth(false, detail)
    this.failures += 1
    if (this.disposed || this.paused || this.restartTimer) return
    if (this.failures > 6) {
      this.log('bridge: giving up after repeated failures')
      return
    }
    const delay = Math.min(1500 * this.failures, 12000)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.disposed && !this.paused) this.launch()
    }, delay)
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.handleLine(line)
      index = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > 65536) this.buffer = ''
  }

  private handleLine(line: string): void {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    if (payload.ok === false) {
      this.setHealth(false, String(payload.error ?? 'bridge error'))
      return
    }

    if (payload.event === 'ready') {
      this.failures = 0
      this.setHealth(true, payload.media === false ? 'ready (no smtc)' : 'ready')
      this.log(`bridge: ready media=${payload.media !== false}`)
      return
    }

    if (payload.type === 'net') {
      this.handlers.onNet({
        downBps: Number(payload.down ?? 0),
        upBps: Number(payload.up ?? 0)
      })
      return
    }

    if (payload.type === 'media') {
      const rawTitle = String(payload.title ?? '').trim()
      if (payload.available === false || !rawTitle) {
        // 没有标题的会话没有展示价值（Xbox Game Bar 之类的空壳）
        this.media = { ...EMPTY_MEDIA }
      } else {
        const sourceAppId = String(payload.sourceAppId ?? '')
        this.media = {
          available: true,
          sourceAppId,
          appName: friendlyAppName(sourceAppId),
          title: rawTitle,
          artist: String(payload.artist ?? ''),
          album: String(payload.album ?? ''),
          status: (payload.status as MediaState['status']) ?? 'Playing',
          position: Number(payload.position ?? 0),
          duration: Number(payload.duration ?? 0),
          thumbnail: this.media.thumbnail,
          thumbnailReal: this.media.thumbnailReal,
          canNext: Boolean(payload.canNext),
          canPrev: Boolean(payload.canPrev),
          canPlayPause: Boolean(payload.canPlayPause)
        }
      }
      this.handlers.onMedia(this.media)
    }
  }

  applyThumbnail(dataUrl: string): void {
    if (!this.media.available) return
    if (this.media.thumbnail === dataUrl) return
    this.media = { ...this.media, thumbnail: dataUrl, thumbnailReal: true }
    this.handlers.onMedia(this.media)
  }

  clearThumbnail(): void {
    if (!this.media.thumbnail && !this.media.thumbnailReal) return
    this.media = { ...this.media, thumbnail: '', thumbnailReal: false }
    this.handlers.onMedia(this.media)
  }

  dispose(): void {
    this.disposed = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
    this.killChild()
  }
}
