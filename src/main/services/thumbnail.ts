import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolvePowerShell } from './bridge'

const MAX_OUTPUT = 9 * 1024 * 1024
const CACHE_LIMIT = 40
const FAILURE_LIMIT = 3

function toDataUrl(base64: string): string {
  const mime = base64.startsWith('iVBORw0KGgo')
    ? 'image/png'
    : base64.startsWith('/9j/')
      ? 'image/jpeg'
      : base64.startsWith('R0lGOD')
        ? 'image/gif'
        : base64.startsWith('UklGR')
          ? 'image/webp'
          : 'image/png'
  return `data:${mime};base64,${base64}`
}

export function thumbnailKey(title: string, artist: string, album: string): string {
  return `${title}||${artist}||${album}`.toLowerCase()
}

export class ThumbnailService {
  private readonly cache = new Map<string, string>()
  private inflight: string | null = null
  private child: ChildProcess | null = null
  private failures = 0
  private disabled = false
  private disposed = false

  constructor(
    private readonly scriptPath: string,
    private readonly onThumbnail: (key: string, dataUrl: string) => void,
    private readonly onLog?: (message: string) => void
  ) {}

  get isDisabled(): boolean {
    return this.disabled
  }

  /** 自检通过后重新启用（清掉失败计数与禁用标记） */
  reset(): void {
    this.failures = 0
    this.disabled = false
  }

  private log(message: string): void {
    this.onLog?.(message)
  }

  request(key: string): void {
    if (this.disposed || this.disabled || !key) return
    if (key === this.inflight) return

    const cached = this.cache.get(key)
    if (cached) {
      this.onThumbnail(key, cached)
      return
    }

    if (!existsSync(this.scriptPath)) {
      this.disabled = true
      this.log(`thumbnail: script missing at ${this.scriptPath}`)
      return
    }

    this.inflight = key
    let child: ChildProcess
    try {
      child = spawn(
        resolvePowerShell(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (error) {
      this.inflight = null
      this.recordFailure(`spawn failed: ${String(error)}`)
      return
    }

    this.child = child
    let stdout = ''
    let stderr = ''
    let aborted = false

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_OUTPUT && !aborted) {
        aborted = true
        this.log('thumbnail: output too large, aborting')
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-600)
    })

    child.on('error', (error) => {
      this.inflight = null
      this.child = null
      this.recordFailure(`process error: ${String(error)}`)
    })

    child.on('exit', (code) => {
      this.child = null
      this.inflight = null
      if (this.disposed) return

      const base64 = stdout.trim()
      if (code === 0 && base64.length > 100) {
        const dataUrl = toDataUrl(base64)
        this.remember(key, dataUrl)
        this.failures = 0
        this.onThumbnail(key, dataUrl)
        this.log(`thumbnail: captured for ${key.slice(0, 60)}`)
        return
      }

      this.recordFailure(stderr.trim() || `exit code ${code}`)
    })
  }

  private remember(key: string, dataUrl: string): void {
    this.cache.set(key, dataUrl)
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next()
      if (oldest.done) break
      this.cache.delete(oldest.value)
    }
  }

  private recordFailure(reason: string): void {
    this.failures += 1
    this.log(`thumbnail: attempt failed (${this.failures}/${FAILURE_LIMIT}) ${reason}`)
    if (this.failures >= FAILURE_LIMIT) {
      this.disabled = true
      this.log('thumbnail: disabled, falling back to placeholder art')
    }
  }

  dispose(): void {
    this.disposed = true
    const child = this.child
    this.child = null
    this.inflight = null
    if (!child) return
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
}
