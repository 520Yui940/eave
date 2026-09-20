import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import type { StashEntry } from '../../shared/types'

/** 暂存条目上限 */
const MAX_ENTRIES = 12
/** 复制区总容量：超过后只允许「引用」模式 */
const MAX_COPY_TOTAL = 200 * 1024 * 1024
/** 小于等于 8MB 的文件复制进 stash 目录（源文件删了也能拖出），更大的只引用原路径 */
const COPY_THRESHOLD = 8 * 1024 * 1024

/**
 * 文件暂存架。设计取舍（已与用户对齐）：
 * - 只收文件/文件夹（文本类暂存由剪贴板钉住覆盖）
 * - 混合存储：小文件复制、大文件/文件夹引用原路径（引用失效的条目在载入时剔除）
 * - manifest 持久化，应用退出不清空
 */
export class StashService {
  private readonly dir: string
  private readonly manifestPath: string
  private entries: StashEntry[] = []

  constructor() {
    this.dir = path.join(app.getPath('userData'), 'stash')
    this.manifestPath = path.join(this.dir, 'manifest.json')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    this.load()
  }

  get list(): StashEntry[] {
    return this.entries
  }

  get totalBytes(): number {
    return this.entries.filter((e) => e.stored === 'copy').reduce((sum, e) => sum + e.sizeBytes, 0)
  }

  private load(): void {
    try {
      if (!existsSync(this.manifestPath)) return
      const raw = JSON.parse(readFileSync(this.manifestPath, 'utf-8')) as StashEntry[]
      // 引用型条目源文件可能已被移走：载入时静默剔除失效项
      this.entries = raw.filter((e) => e.stored === 'copy' || existsSync(e.path))
    } catch {
      this.entries = []
    }
  }

  private persist(): void {
    try {
      const temp = `${this.manifestPath}.tmp`
      writeFileSync(temp, JSON.stringify(this.entries, null, 2), 'utf-8')
      renameSync(temp, this.manifestPath)
    } catch {
      /* manifest 写失败不影响本次会话内的暂存 */
    }
  }

  add(paths: string[]): { added: number; error: string } {
    let added = 0
    let error = ''
    for (const rawPath of paths) {
      if (this.entries.length >= MAX_ENTRIES) {
        error = `暂存架最多 ${MAX_ENTRIES} 条，先清理再拖`
        break
      }
      if (this.entries.some((e) => e.path === rawPath)) {
        error = '已经在架上了'
        continue
      }
      let st
      try {
        st = statSync(rawPath)
      } catch {
        error = '文件不存在或不可读'
        continue
      }
      const isFolder = st.isDirectory()
      const base = path.basename(rawPath)
      const id = randomUUID()
      let stored: StashEntry['stored'] = 'ref'
      let finalPath = rawPath
      let sizeBytes = st.size

      if (!isFolder && st.size <= COPY_THRESHOLD) {
        if (this.totalBytes + st.size > MAX_COPY_TOTAL) {
          error = '复制区满了（200MB），大文件走引用但不占空间——这条没存成'
          continue
        }
        try {
          const ext = path.extname(rawPath)
          const target = path.join(this.dir, `${id}${ext}`)
          copyFileSync(rawPath, target)
          stored = 'copy'
          finalPath = target
        } catch {
          // 复制失败退回引用模式：源路径还在就能用
          stored = 'ref'
          finalPath = rawPath
        }
      }
      if (isFolder) sizeBytes = 0

      this.entries.unshift({
        id,
        name: base,
        path: finalPath,
        kind: isFolder ? 'folder' : 'file',
        stored,
        sizeBytes,
        time: Date.now()
      })
      added++
    }
    if (added > 0) this.persist()
    return { added, error }
  }

  remove(id: string): void {
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) return
    if (entry.stored === 'copy') {
      try {
        rmSync(entry.path, { force: true })
      } catch {
        /* 副本删不掉就留着，不挡操作 */
      }
    }
    this.entries = this.entries.filter((e) => e.id !== id)
    this.persist()
  }

  clear(): void {
    for (const entry of this.entries) {
      if (entry.stored === 'copy') {
        try {
          rmSync(entry.path, { force: true })
        } catch {
          /* ignore */
        }
      }
    }
    this.entries = []
    this.persist()
  }

  /** 拖出/打开前确认路径仍有效 */
  resolve(id: string): string | null {
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) return null
    return existsSync(entry.path) ? entry.path : null
  }
}
