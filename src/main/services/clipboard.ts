import { clipboard as electronClipboard, type NativeImage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import type { ClipboardItem } from '../../shared/types'

interface ClipboardBridge {
  readText(type?: 'selection' | 'clipboard'): string
  readImage(type?: 'selection' | 'clipboard'): NativeImage
  availableFormats(type?: 'selection' | 'clipboard'): string[]
}

const clipboard = electronClipboard as unknown as ClipboardBridge

const MAX_TEXT_BYTES = 512 * 1024
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const PREVIEW_LENGTH = 220
/**
 * 图片条目单独设上限：一张 6MB 截图转成 base64 就是 8MB 字符串，
 * 跟着 60 条的文本上限走最坏情况能吃掉几百 MB 常驻内存。
 * 图片上限独立 10 张（≈80MB 最坏值，实际多为几十 KB 的截图缩略）。
 */
const IMAGE_LIMIT = 10

function digest(input: Buffer | string): string {
  return createHash('sha1').update(input).digest('hex')
}

function buildPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= PREVIEW_LENGTH) return flat
  return `${flat.slice(0, PREVIEW_LENGTH)}…`
}

export class ClipboardService {
  private items: ClipboardItem[] = []
  private timer: NodeJS.Timeout | null = null
  private lastTextDigest = ''
  private lastImageDigest = ''
  private tick = 0
  private enabled = true
  private limit = 60

  get list(): ClipboardItem[] {
    return this.items
  }

  configure(enabled: boolean, limit: number): void {
    this.enabled = enabled
    this.limit = Math.max(10, Math.min(300, Math.round(limit) || 60))
    this.trim()
  }

  start(onUpdate: (items: ClipboardItem[]) => void, intervalMs = 900): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (this.poll()) onUpdate(this.items)
    }, intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  togglePin(id: string): ClipboardItem[] {
    this.items = this.items.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item))
    this.sortAndTrim()
    return this.items
  }

  remove(id: string): ClipboardItem[] {
    this.items = this.items.filter((item) => item.id !== id)
    return this.items
  }

  clearUnpinned(): ClipboardItem[] {
    this.items = this.items.filter((item) => item.pinned)
    return this.items
  }

  clearAll(): ClipboardItem[] {
    this.items = []
    return this.items
  }

  private poll(): boolean {
    if (!this.enabled) return false
    this.tick += 1
    let changed = false

    try {
      const text = clipboard.readText()
      if (text && Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES) {
        const hash = digest(text)
        if (hash !== this.lastTextDigest) {
          this.lastTextDigest = hash
          this.ingest({ kind: 'text', text, imageDataUrl: '' })
          changed = true
        }
      }
    } catch {
      /* clipboard busy */
    }

    if (this.tick % 3 === 0) {
      try {
        const image = clipboard.readImage()
        if (!image.isEmpty()) {
          const png = image.toPNG()
          if (png.length > 0 && png.length <= MAX_IMAGE_BYTES) {
            const hash = digest(png)
            if (hash !== this.lastImageDigest) {
              this.lastImageDigest = hash
              this.ingest({
                kind: 'image',
                text: '',
                imageDataUrl: `data:image/png;base64,${png.toString('base64')}`
              })
              changed = true
            }
          }
        }
      } catch {
        /* ignore image read errors */
      }
    }

    return changed
  }

  private ingest(partial: Pick<ClipboardItem, 'kind' | 'text' | 'imageDataUrl'>): void {
    const duplicateIndex = this.items.findIndex(
      (item) => item.kind === partial.kind && item.text === partial.text && item.imageDataUrl === partial.imageDataUrl
    )

    if (duplicateIndex >= 0) {
      const [existing] = this.items.splice(duplicateIndex, 1)
      this.items.unshift({ ...existing, time: Date.now() })
      return
    }

    const payloadBytes = partial.imageDataUrl
      ? Math.round((partial.imageDataUrl.length - partial.imageDataUrl.indexOf(',')) * 0.75)
      : Buffer.byteLength(partial.text, 'utf8')

    this.items.unshift({
      id: randomUUID(),
      kind: partial.kind,
      text: partial.text,
      preview: partial.kind === 'image' ? '图片' : buildPreview(partial.text),
      imageDataUrl: partial.imageDataUrl,
      sizeBytes: Math.max(0, payloadBytes),
      time: Date.now(),
      pinned: false
    })

    this.sortAndTrim()
  }

  private sortAndTrim(): void {
    const pinned = this.items.filter((item) => item.pinned)
    const rest = this.items.filter((item) => !item.pinned).slice(0, this.limit)
    const merged = [...pinned, ...rest]
    // 图片独立裁剪：保留 pinned 优先，超出的从最旧的图片开始丢
    const images = merged.filter((item) => item.kind === 'image')
    if (images.length > IMAGE_LIMIT) {
      const evict = new Set(images.slice(IMAGE_LIMIT).map((item) => item.id))
      this.items = merged.filter((item) => item.kind !== 'image' || !evict.has(item.id))
    } else {
      this.items = merged
    }
  }

  private trim(): void {
    this.sortAndTrim()
  }
}
