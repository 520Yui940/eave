export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const fixed = value >= 100 || unit === 0 ? 0 : digits
  return `${value.toFixed(fixed)} ${units[unit]}`
}

export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSecond
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const fixed = value >= 100 || unit === 0 ? 0 : 1
  return `${value.toFixed(fixed)} ${units[unit]}`
}

export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const seconds = Math.floor(totalSeconds % 60)
  const minutes = Math.floor((totalSeconds / 60) % 60)
  const hours = Math.floor(totalSeconds / 3600)
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分钟`
}

export function formatRelative(timestamp: number): string {
  const delta = Date.now() - timestamp
  if (delta < 8000) return '刚刚'
  if (delta < 60000) return `${Math.floor(delta / 1000)} 秒前`
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`
  return `${Math.floor(delta / 86400000)} 天前`
}

export function heatColor(ratio: number, warn = 0.82, danger = 0.94): string {
  if (ratio >= danger) return 'var(--danger)'
  if (ratio >= warn) return 'var(--warn)'
  if (ratio >= 0.6) return 'var(--accent)'
  return 'var(--ok)'
}

/** 由曲目名散列出一对稳定的颜色，用作无封面时的占位底图 */
export function coverPalette(seed: string): { from: string; to: string; hue: number } {
  let hash = 2166136261
  const text = seed || 'eave'
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const hue = Math.abs(hash) % 360
  const shift = 28 + (Math.abs(hash >> 8) % 46)
  return {
    hue,
    from: `hsl(${hue} 42% 26%)`,
    to: `hsl(${(hue + shift) % 360} 48% 14%)`
  }
}

export function appInitial(label: string): string {
  const trimmed = (label ?? '').trim()
  if (!trimmed) return '♪'
  const first = trimmed[0]
  return /[a-zA-Z0-9]/.test(first) ? first.toUpperCase() : first
}
