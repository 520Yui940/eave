/**
 * 封面主色提取 —— 用于「强调色跟随封面」。
 *
 * 内存/性能约束：
 * - 采样画布固定 24×24（约 2.3KB 像素缓冲），一次性画完即释放
 * - 结果是 hex 字符串，按封面 dataURL 缓存；缓存 Map 有上限，超出丢最旧
 * - 仅在曲目切换时触发一次，不进任何动画循环
 */

const SAMPLE = 24
const CACHE_LIMIT = 12

const cache = new Map<string, string>()

let canvas: HTMLCanvasElement | null = null

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** 在 HSL 色轮上把 RGB 均匀分成 12 桶，返回桶号；灰色返回 -1 */
function hueBucket(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  // 过滤接近灰/黑/白的像素：饱和度太低或明度太极端都不适合当强调色
  if (delta < 40 || max < 48 || min > 216) return -1
  let hue: number
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue = Math.round((hue * 60 + 360) % 360)
  return Math.floor(hue / 30)
}

function extractAsync(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        if (!canvas) canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          resolve('')
          return
        }
        canvas.width = SAMPLE
        canvas.height = SAMPLE
        ctx.clearRect(0, 0, SAMPLE, SAMPLE)
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
        const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)

        // 每个色桶累计 RGB 与计数，最后取成员最多的桶求平均
        const sums = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, n: 0 }))
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue
          const bucket = hueBucket(data[i], data[i + 1], data[i + 2])
          if (bucket < 0) continue
          const entry = sums[bucket]
          entry.r += data[i]
          entry.g += data[i + 1]
          entry.b += data[i + 2]
          entry.n += 1
        }

        let best = sums[0]
        for (const entry of sums) if (entry.n > best.n) best = entry
        if (best.n === 0) {
          resolve('')
          return
        }

        // 归一后压进「有活力但可读」的亮度带（30%~58%）
        let r = best.r / best.n
        let g = best.g / best.n
        let b = best.b / best.n
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const light = (max + min) / 510
        if (light < 0.3) {
          const k = 0.3 / Math.max(light, 0.01)
          r *= k
          g *= k
          b *= k
        } else if (light > 0.58) {
          const k = 0.58 / light
          r *= k
          g *= k
          b *= k
        }
        resolve(rgbToHex(Math.round(Math.min(255, r)), Math.round(Math.min(255, g)), Math.round(Math.min(255, b))))
      } catch {
        resolve('')
      }
    }
    img.onerror = () => resolve('')
    img.src = dataUrl
  })
}

/**
 * 缓存 key 不能直接用整段 dataURL —— 真实封面一张几百 KB，12 条 key 就白吃几 MB。
 * 用「长度 + 尾部指纹」代替，碰撞概率对取色场景可忽略，单条 key ~50 字节。
 */
function cacheKey(dataUrl: string): string {
  return `${dataUrl.length}:${dataUrl.slice(-24)}`
}

/** 取封面主色；同一封面只算一次（异步），其余全走缓存 */
export function accentFromCover(dataUrl: string): Promise<string> {
  if (!dataUrl) return Promise.resolve('')
  const key = cacheKey(dataUrl)
  const hit = cache.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  return extractAsync(dataUrl).then((color) => {
    cache.set(key, color)
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      cache.delete(oldest.value)
    }
    return color
  })
}
