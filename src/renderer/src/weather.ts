/**
 * 天气（wttr.in，无 key）+ 农历（Intl 内置中文历法）。
 *
 * 内存/流量约束：
 * - 天气 JSON ~5KB，30 分钟刷新一次，localStorage 持久缓存
 * - 断网/超时静默降级为「--」，面板不崩
 * - 农历是 Intl 现成能力，零成本
 */

export interface WeatherInfo {
  tempC: string
  desc: string
  feelsC: string
  humidity: string
  windKmph: string
  fetchedAt: number
}

const CACHE_KEY = 'eave.weather.v1'
const CACHE_TTL = 30 * 60_000
const TIMEOUT_MS = 8000

interface WeatherCache {
  city: string
  info: WeatherInfo
}

export function loadWeatherCache(): WeatherCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WeatherCache
    if (!parsed?.info?.tempC) return null
    return parsed
  } catch {
    return null
  }
}

export function weatherCacheFresh(city: string): WeatherInfo | null {
  const hit = loadWeatherCache()
  if (!hit) return null
  if (hit.city !== city) return null
  if (Date.now() - hit.info.fetchedAt > CACHE_TTL) return null
  return hit.info
}

/** 拉天气；city 为空时 wttr.in 按 IP 定位。失败返回 null，调用方保持旧值 */
export async function fetchWeather(city: string): Promise<WeatherInfo | null> {
  const target = city.trim() ? encodeURIComponent(city.trim()) : ''
  const url = `https://wttr.in/${target}?format=j1`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const data = (await response.json()) as {
      current_condition?: Array<{
        temp_C?: string
        FeelsLikeC?: string
        humidity?: string
        windspeedKmph?: string
        weatherDesc?: Array<{ value?: string }>
        lang_zh?: Array<{ value?: string }>
      }>
    }
    const current = data.current_condition?.[0]
    if (!current) return null

    const info: WeatherInfo = {
      tempC: current.temp_C ?? '--',
      desc: current.lang_zh?.[0]?.value ?? current.weatherDesc?.[0]?.value ?? '--',
      feelsC: current.FeelsLikeC ?? '--',
      humidity: current.humidity ?? '--',
      windKmph: current.windspeedKmph ?? '--',
      fetchedAt: Date.now()
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ city, info } satisfies WeatherCache))
    } catch {
      /* ignore quota */
    }
    return info
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 天气描述 → emoji；wttr.in 中文/英文描述都能兜住大面 */
export function weatherEmoji(desc: string): string {
  const text = desc.toLowerCase()
  if (text.includes('雷') || text.includes('thunder')) return '⛈️'
  if (text.includes('雪') || text.includes('snow')) return '🌨️'
  if (text.includes('雨') || text.includes('rain') || text.includes('drizzle')) return '🌧️'
  if (text.includes('雾') || text.includes('霾') || text.includes('mist') || text.includes('fog') || text.includes('haze')) return '🌫️'
  if (text.includes('阴') || text.includes('overcast') || text.includes('cloud')) return '☁️'
  if (text.includes('晴') || text.includes('clear') || text.includes('sun')) return '☀️'
  return '🌡️'
}

const LUNAR_FORMATTER = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  month: 'long',
  day: 'numeric'
})

/** 农历月日，如「八月十五」。Intl 内置中文历，零依赖 */
export function lunarLabel(date = new Date()): string {
  try {
    // 去掉「农历」前缀（部分实现会带），只留月日
    return LUNAR_FORMATTER.format(date).replace(/^农历/, '')
  } catch {
    return ''
  }
}
