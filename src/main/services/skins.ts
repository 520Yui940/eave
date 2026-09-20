import { app, dialog, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { SkinDef, SkinPalette } from '../../shared/types'

/**
 * 皮肤系统。约定（已与用户对齐）：
 * - 皮肤只管颜色变量 + 背景图（模糊/暗化/不透明度），**不碰布局尺寸**——
 *   346px 面板高度预算是 0.3.1 修好的，皮肤没有权力动它
 * - 每套皮肤含 dark / light / night 三个调色板，App 按当前主题档取用
 * - 内置皮肤不可删除；自定义皮肤存 userData/skins/<id>/skin.json
 * - skin.json 里 bgImage 存「文件名」（背景图与 skin.json 同目录）；
 *   导出时把背景图一并拷到目标目录，导入时同样按同名文件解析
 */

export const BUILTIN_SKINS: SkinDef[] = [
  {
    id: 'builtin:cream',
    name: '奶油淡彩',
    builtin: true,
    bgImage: '',
    bgBlur: 0,
    bgDim: 0,
    bgOpacity: 1,
    dark: {
      bg: '#211a15',
      raised: '#2c241d',
      sunken: '#191310',
      text: '#f6efe6',
      textDim: 'rgba(246, 239, 230, 0.66)',
      textFaint: 'rgba(246, 239, 230, 0.38)',
      hairline: 'rgba(246, 239, 230, 0.09)',
      accent: '#e39a6b'
    },
    light: {
      bg: '#faf3ea',
      raised: '#ffffff',
      sunken: '#f0e6d9',
      text: '#4a3c30',
      textDim: 'rgba(74, 60, 48, 0.66)',
      textFaint: 'rgba(74, 60, 48, 0.4)',
      hairline: 'rgba(74, 60, 48, 0.1)',
      accent: '#c97b4a'
    },
    night: {
      bg: '#171210',
      raised: '#221b16',
      sunken: '#100c0a',
      text: '#e9dfd2',
      textDim: 'rgba(233, 223, 210, 0.6)',
      textFaint: 'rgba(233, 223, 210, 0.34)',
      hairline: 'rgba(233, 223, 210, 0.08)',
      accent: '#d9a06b'
    }
  },
  {
    id: 'builtin:glass',
    name: '通透玻璃',
    builtin: true,
    bgImage: '',
    bgBlur: 0,
    bgDim: 0,
    bgOpacity: 1,
    dark: {
      bg: 'rgba(17, 19, 26, 0.74)',
      raised: 'rgba(255, 255, 255, 0.1)',
      sunken: 'rgba(255, 255, 255, 0.06)',
      text: '#ffffff',
      textDim: 'rgba(255, 255, 255, 0.66)',
      textFaint: 'rgba(255, 255, 255, 0.38)',
      hairline: 'rgba(255, 255, 255, 0.16)',
      accent: '#6fc8f2'
    },
    light: {
      bg: 'rgba(247, 250, 253, 0.74)',
      raised: 'rgba(255, 255, 255, 0.85)',
      sunken: 'rgba(28, 36, 48, 0.05)',
      text: '#1c2430',
      textDim: 'rgba(28, 36, 48, 0.66)',
      textFaint: 'rgba(28, 36, 48, 0.4)',
      hairline: 'rgba(28, 36, 48, 0.12)',
      accent: '#0a84ff'
    },
    night: {
      bg: 'rgba(6, 8, 13, 0.8)',
      raised: 'rgba(255, 255, 255, 0.08)',
      sunken: 'rgba(255, 255, 255, 0.04)',
      text: '#e8edf4',
      textDim: 'rgba(232, 237, 244, 0.6)',
      textFaint: 'rgba(232, 237, 244, 0.34)',
      hairline: 'rgba(232, 237, 244, 0.12)',
      accent: '#67b8e8'
    }
  },
  {
    id: 'builtin:terminal',
    name: '终端复古',
    builtin: true,
    bgImage: '',
    bgBlur: 0,
    bgDim: 0,
    bgOpacity: 1,
    dark: {
      bg: '#04120a',
      raised: '#0a1d10',
      sunken: '#071709',
      text: '#4ade80',
      textDim: 'rgba(74, 222, 128, 0.68)',
      textFaint: 'rgba(74, 222, 128, 0.4)',
      hairline: 'rgba(74, 222, 128, 0.14)',
      accent: '#22c55e'
    },
    light: {
      bg: '#eff7f0',
      raised: '#ffffff',
      sunken: '#e0eee3',
      text: '#14532d',
      textDim: 'rgba(20, 83, 45, 0.66)',
      textFaint: 'rgba(20, 83, 45, 0.4)',
      hairline: 'rgba(20, 83, 45, 0.12)',
      accent: '#16a34a'
    },
    night: {
      bg: '#020a05',
      raised: '#061509',
      sunken: '#041006',
      text: '#3ecf70',
      textDim: 'rgba(62, 207, 112, 0.62)',
      textFaint: 'rgba(62, 207, 112, 0.34)',
      hairline: 'rgba(62, 207, 112, 0.12)',
      accent: '#1eb854'
    }
  }
]

const PALETTE_KEYS: (keyof SkinPalette)[] = [
  'bg',
  'raised',
  'sunken',
  'text',
  'textDim',
  'textFaint',
  'hairline',
  'accent'
]

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 校验并归一化一份皮肤 JSON；不合法的字段直接报错，不静默兜底 */
function validateSkin(raw: unknown): Omit<SkinDef, 'id'> {
  if (!raw || typeof raw !== 'object') throw new Error('皮肤文件不是 JSON 对象')
  const source = raw as Partial<SkinDef>
  if (typeof source.name !== 'string' || !source.name.trim()) throw new Error('缺少皮肤名 name')
  for (const variant of ['dark', 'light', 'night'] as const) {
    const palette = source[variant] as SkinPalette | undefined
    if (!palette || typeof palette !== 'object') throw new Error(`缺少 ${variant} 调色板`)
    for (const key of PALETTE_KEYS) {
      if (typeof palette[key] !== 'string' || !palette[key]) {
        throw new Error(`${variant} 调色板缺少 ${key}`)
      }
    }
  }
  return {
    name: source.name.trim().slice(0, 20),
    builtin: false,
    bgImage: typeof source.bgImage === 'string' ? source.bgImage : '',
    bgBlur: clamp(Number(source.bgBlur ?? 0) || 0, 0, 30),
    bgDim: clamp(Number(source.bgDim ?? 0) || 0, 0, 1),
    bgOpacity: clamp(Number(source.bgOpacity ?? 1) || 1, 0.2, 1),
    dark: source.dark as SkinPalette,
    light: source.light as SkinPalette,
    night: source.night as SkinPalette
  }
}

export class SkinService {
  private readonly dir: string

  constructor() {
    this.dir = path.join(app.getPath('userData'), 'skins')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  private skinDir(id: string): string {
    return path.join(this.dir, id)
  }

  /** bgImage 输出为 file:// URL，渲染层 background-image 可直接用 */
  list(): SkinDef[] {
    const custom: SkinDef[] = []
    try {
      for (const id of readdirSync(this.dir)) {
        const file = path.join(this.skinDir(id), 'skin.json')
        if (!existsSync(file)) continue
        try {
          const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SkinDef>
          const def = validateSkin(parsed)
          const bgAbs = def.bgImage ? path.join(this.skinDir(id), def.bgImage) : ''
          custom.push({ ...def, id, bgImage: bgAbs })
        } catch {
          /* 单个坏皮肤不拖累整个列表 */
        }
      }
    } catch {
      /* ignore */
    }
    return [...BUILTIN_SKINS, ...custom].map((skin) => ({
      ...skin,
      bgImage: skin.bgImage && existsSync(skin.bgImage) ? pathToFileURL(skin.bgImage).href : ''
    }))
  }

  /** 弹文件选择框导入皮肤；背景图若与 JSON 同目录会一并复制进 userData */
  async import(parent: BrowserWindow | null): Promise<{ ok: boolean; error: string }> {
    try {
      const openOptions: Electron.OpenDialogOptions = {
        title: '导入皮肤',
        filters: [{ name: 'Eave 皮肤', extensions: ['json'] }],
        properties: ['openFile']
      }
      const picked = parent
        ? await dialog.showOpenDialog(parent, openOptions)
        : await dialog.showOpenDialog(openOptions)
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, error: '' }
      const jsonPath = picked.filePaths[0]
      const def = validateSkin(JSON.parse(readFileSync(jsonPath, 'utf-8')))

      const id = `skin-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
      const targetDir = this.skinDir(id)
      mkdirSync(targetDir, { recursive: true })

      // 背景图：skin.json 里存文件名，导入时从源目录解析同名文件
      if (def.bgImage) {
        const sourceBg = path.resolve(path.dirname(jsonPath), def.bgImage)
        const ext = path.extname(sourceBg).toLowerCase()
        if (existsSync(sourceBg) && IMAGE_EXTENSIONS.includes(ext)) {
          const target = path.join(targetDir, `bg${ext}`)
          copyFileSync(sourceBg, target)
          def.bgImage = `bg${ext}`
        } else {
          def.bgImage = ''
        }
      }

      writeFileSync(path.join(targetDir, 'skin.json'), JSON.stringify(def, null, 2), 'utf-8')
      return { ok: true, error: '' }
    } catch (error) {
      return { ok: false, error: String(error).replace(/^[^:]*:\s*/, '') }
    }
  }

  /** 导出皮肤：JSON + 背景图（如有）一起落到用户选的目录 */
  async export(parent: BrowserWindow | null, id: string): Promise<{ ok: boolean; error: string }> {
    const skin = this.list().find((s) => s.id === id)
    if (!skin || skin.builtin) return { ok: false, error: skin ? '内置皮肤不可导出' : '皮肤不存在' }
    try {
      const saveOptions: Electron.SaveDialogOptions = {
        title: '导出皮肤',
        defaultPath: path.join(app.getPath('documents'), `${skin.name}.eaveskin.json`)
      }
      const picked = parent
        ? await dialog.showSaveDialog(parent, saveOptions)
        : await dialog.showSaveDialog(saveOptions)
      if (picked.canceled || !picked.filePath) return { ok: false, error: '' }
      const target = picked.filePath
      // bgImage 从 file:// URL 还原成文件名，与 JSON 同目录落盘
      const payload = { ...skin, id: undefined, builtin: false, bgImage: '' }
      if (skin.bgImage.startsWith('file://')) {
        const bgSource = path.resolve(fileURLToPath(skin.bgImage))
        if (existsSync(bgSource)) {
          const name = path.basename(bgSource)
          copyFileSync(bgSource, path.join(path.dirname(target), name))
          payload.bgImage = name
        }
      }
      writeFileSync(target, JSON.stringify(payload, null, 2), 'utf-8')
      return { ok: true, error: '' }
    } catch (error) {
      return { ok: false, error: String(error).replace(/^[^:]*:\s*/, '') }
    }
  }

  delete(id: string): { ok: boolean; error: string } {
    if (id.startsWith('builtin:')) return { ok: false, error: '内置皮肤不可删除' }
    const targetDir = this.skinDir(id)
    if (!existsSync(targetDir)) return { ok: false, error: '皮肤不存在' }
    try {
      rmSync(targetDir, { recursive: true, force: true })
      return { ok: true, error: '' }
    } catch (error) {
      return { ok: false, error: String(error).replace(/^[^:]*:\s*/, '') }
    }
  }
}
