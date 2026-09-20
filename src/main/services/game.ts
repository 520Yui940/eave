import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { screen } from 'electron'
import type { GameModeState } from '../../shared/types'
import { getWinApi } from './winapi'

interface GameModeOptions {
  resolvePowerShell: () => string
  resolveScript: (name: string) => string
  onLog: (message: string) => void
}

/**
 * 游戏形态：
 * - 全屏检测走 koffi（GetForegroundWindow + GetWindowRect 对比显示器边界），挂在 1Hz tick 上，零子进程
 * - GPU 占用按需短进程：只有游戏条激活时才拉 eave-gpu.ps1（1Hz Get-Counter 求和），退出即杀
 *   ——「不新增常驻进程」红线是 24/7 意义上的，会话级短进程不碰线
 * - 触发策略（用户拍板）：任何前台全屏都触发，exe 命中排除名单则不触发
 */
export class GameModeService {
  private readonly opts: GameModeOptions
  private timer: NodeJS.Timeout | null = null
  private gpuProc: ChildProcess | null = null
  private gpuBuffer = ''
  private active = false
  private startedAt = 0
  private exeName = ''
  private enabled = true
  private exclude: string[] = []
  /** exe 名解析中的过渡标记：避免 1Hz tick 重复派 PowerShell */
  private resolving = false

  constructor(opts: GameModeOptions) {
    this.opts = opts
  }

  get state(): GameModeState {
    return {
      active: this.active,
      exeName: this.exeName,
      startedAt: this.startedAt
    }
  }

  configure(enabled: boolean, exclude: string[]): void {
    this.enabled = enabled
    this.exclude = exclude.map((name) => name.trim().toLowerCase()).filter(Boolean)
    if (!enabled) this.deactivate()
  }

  start(onUpdate: (state: GameModeState) => void, onGpu: (value: number) => void, intervalMs = 1000): void {
    if (this.timer) return
    this.onUpdate = onUpdate
    this.onGpu = onGpu
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.stopGpu()
  }

  private onUpdate: (state: GameModeState) => void = () => undefined
  private onGpu: (value: number) => void = () => undefined

  private tick(): void {
    if (!this.enabled) {
      this.deactivate()
      return
    }
    const hit = this.isForegroundFullscreen()
    if (hit) {
      if (!this.active && !this.resolving) {
        this.resolving = true
        this.resolveExe(hit.pid, (exe) => {
          this.resolving = false
          // 解析期间用户可能已退出全屏，激活前再确认一次
          if (!this.isForegroundFullscreen()) return
          if (exe && this.exclude.includes(exe)) {
            this.opts.onLog(`[game] fullscreen ${exe} excluded`)
            return
          }
          this.activate(exe)
        })
      }
    } else {
      this.deactivate()
    }
  }

  /** 前台窗口完整覆盖某台显示器边界（2px 容差）即视为全屏 */
  private isForegroundFullscreen(): { pid: number } | null {
    const fg = getWinApi().readForeground()
    if (!fg) return null
    const { rect, pid } = fg
    const left = Number(rect.left)
    const top = Number(rect.top)
    const right = Number(rect.right)
    const bottom = Number(rect.bottom)
    if (right <= left || bottom <= top) return null

    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    const display = screen
      .getAllDisplays()
      .find(
        (d) =>
          cx >= d.bounds.x &&
          cx < d.bounds.x + d.bounds.width &&
          cy >= d.bounds.y &&
          cy < d.bounds.y + d.bounds.height
      )
    if (!display) return null

    const bounds = display.bounds
    const tolerance = 2
    if (
      left <= bounds.x + tolerance &&
      top <= bounds.y + tolerance &&
      right >= bounds.x + bounds.width - tolerance &&
      bottom >= bounds.y + bounds.height - tolerance
    ) {
      return { pid }
    }
    return null
  }

  /** 一次性 PowerShell 解析前台进程名；失败返回空串（空串不会命中排除名单） */
  private resolveExe(pid: number, onDone: (exe: string) => void): void {
    let settled = false
    const finish = (value: string): void => {
      if (settled) return
      settled = true
      onDone(value)
    }
    try {
      const child = spawn(
        this.opts.resolvePowerShell(),
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).ProcessName`],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let out = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        out += chunk
      })
      child.on('exit', () => {
        const name = out.trim().toLowerCase()
        finish(name ? `${name}.exe` : '')
      })
      child.on('error', () => finish(''))
      setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        finish('')
      }, 3000).unref?.()
    } catch {
      finish('')
    }
  }

  private activate(exeName: string): void {
    this.active = true
    this.exeName = exeName
    this.startedAt = Date.now()
    this.startGpu()
    this.onUpdate(this.state)
  }

  private deactivate(): void {
    if (!this.active) return
    this.active = false
    this.exeName = ''
    this.startedAt = 0
    this.stopGpu()
    this.onUpdate(this.state)
  }

  private startGpu(): void {
    if (this.gpuProc) return
    const script = this.opts.resolveScript('eave-gpu.ps1')
    if (!existsSync(script)) {
      this.opts.onLog('[game] eave-gpu.ps1 missing, gpu stays -1')
      return
    }
    try {
      const child = spawn(
        this.opts.resolvePowerShell(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      this.gpuBuffer = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        this.gpuBuffer += chunk
        const lines = this.gpuBuffer.split(/\r?\n/)
        this.gpuBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line) as { type?: string; value?: number }
            if (parsed.type === 'gpu' && typeof parsed.value === 'number') {
              this.onGpu(parsed.value)
            }
          } catch {
            /* 非 JSON 行忽略 */
          }
        }
      })
      child.on('exit', () => {
        this.gpuProc = null
      })
      this.gpuProc = child
    } catch (error) {
      this.opts.onLog(`[game] gpu sampler spawn failed: ${String(error)}`)
    }
  }

  private stopGpu(): void {
    if (this.gpuProc) {
      try {
        this.gpuProc.kill()
      } catch {
        /* ignore */
      }
    }
    this.gpuProc = null
    this.onGpu(-1)
  }
}
