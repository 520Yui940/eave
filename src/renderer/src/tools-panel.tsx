import { useEffect, useMemo, useState } from 'react'

/**
 * 开发者工具箱：八件套全部纯前端计算（不碰主进程、不碰网络）。
 * 输入类工具依赖「钉住」机制——见 App.tsx 的 pinned 逻辑，否则鼠标出界面板就没了。
 */

export type ToolId = 'json' | 'epoch' | 'color' | 'uuid' | 'encode' | 'regex' | 'hash' | 'stats'

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'epoch', label: '时间' },
  { id: 'color', label: '颜色' },
  { id: 'uuid', label: 'UUID' },
  { id: 'encode', label: '编码' },
  { id: 'regex', label: '正则' },
  { id: 'hash', label: '哈希' },
  { id: 'stats', label: '统计' }
]

type Toast = (message: string) => void

function CopyButton({ text, onToast, label = '复制' }: { text: string; onToast: Toast; label?: string }) {
  return (
    <button
      className="ghost"
      onClick={() => {
        if (!text) return
        void navigator.clipboard.writeText(text)
        onToast('已复制到剪贴板')
      }}
    >
      {label}
    </button>
  )
}

/* ---- JSON ---- */

function JsonTool({ onToast }: { onToast: Toast }) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = (pretty: boolean): void => {
    if (!input.trim()) {
      setError('输入为空')
      setOutput('')
      return
    }
    try {
      const value = JSON.parse(input)
      setOutput(pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value))
      setError('')
    } catch (e) {
      setOutput('')
      setError(String(e).replace(/^[^:]*:\s*/, ''))
    }
  }

  return (
    <div className="tool-stack">
      <textarea
        className="tool-area"
        placeholder='粘贴 JSON，如 {"a":1}'
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
      />
      <div className="tool-row">
        <button className="ghost" onClick={() => run(true)}>格式化</button>
        <button className="ghost" onClick={() => run(false)}>压缩</button>
        <CopyButton text={output} onToast={onToast} />
        <span className="tool-hint">{error ? <em className="tool-error">{error}</em> : ''}</span>
      </div>
      {output ? <pre className="tool-out">{output}</pre> : null}
    </div>
  )
}

/* ---- 时间戳 ---- */

function formatFull(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString('zh-CN', { hour12: false })
}

function EpochTool({ onToast }: { onToast: Toast }) {
  const [ts, setTs] = useState('')
  const [dt, setDt] = useState('')

  const fromTs = useMemo(() => {
    const raw = ts.trim()
    if (/^\d{10}$/.test(raw)) return Number(raw) * 1000
    if (/^\d{13}$/.test(raw)) return Number(raw)
    return null
  }, [ts])

  const fromDt = useMemo(() => {
    if (!dt) return null
    const ms = new Date(dt).getTime()
    return Number.isNaN(ms) ? null : ms
  }, [dt])

  return (
    <div className="tool-stack">
      <div className="tool-row">
        <input
          className="search search--inline"
          placeholder="Unix 时间戳（10 位秒 / 13 位毫秒）"
          value={ts}
          onChange={(e) => setTs(e.target.value)}
          spellCheck={false}
        />
      </div>
      {fromTs !== null ? (
        <div className="tool-row">
          <span className="tool-result">{formatFull(fromTs)}</span>
          <CopyButton text={formatFull(fromTs)} onToast={onToast} />
        </div>
      ) : ts.trim() ? (
        <div className="tool-hint">只认 10 位（秒）或 13 位（毫秒）纯数字</div>
      ) : null}

      <div className="tool-row">
        <input
          type="datetime-local"
          className="search search--inline"
          value={dt}
          onChange={(e) => setDt(e.target.value)}
        />
        <button className="ghost" onClick={() => setDtToNow(setDt)}>现在</button>
      </div>
      {fromDt !== null ? (
        <div className="tool-row">
          <span className="tool-result">
            {Math.floor(fromDt / 1000)} <em className="tool-sub">秒</em> · {fromDt}{' '}
            <em className="tool-sub">毫秒</em>
          </span>
          <CopyButton text={String(Math.floor(fromDt / 1000))} onToast={onToast} />
        </div>
      ) : null}
    </div>
  )
}

function setDtToNow(setDt: (value: string) => void): void {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  setDt(
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(
      now.getMinutes()
    )}`
  )
}

/* ---- 颜色 ---- */

interface Rgb {
  r: number
  g: number
  b: number
}

function parseColor(input: string): Rgb | null {
  const raw = input.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(raw)
  if (hex) {
    const body = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16)
    }
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(raw)
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    if (r <= 255 && g <= 255 && b <= 255) return { r, g, b }
  }
  return null
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function ColorTool({ onToast }: { onToast: Toast }) {
  const [input, setInput] = useState('#0a84ff')
  const rgb = useMemo(() => parseColor(input), [input])
  const hsl = rgb ? rgbToHsl(rgb) : null
  const hexOut = rgb
    ? `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
    : ''
  const rgbOut = rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : ''
  const hslOut = hsl ? `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : ''

  return (
    <div className="tool-stack">
      <div className="tool-row">
        <input
          type="color"
          value={hexOut || '#000000'}
          onChange={(e) => setInput(e.target.value)}
          className="tool-color"
        />
        <input
          className="search search--inline"
          placeholder="#hex 或 rgb(r, g, b)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </div>
      {rgb ? (
        <>
          <div className="tool-row">
            <span className="tool-result">{hexOut}</span>
            <CopyButton text={hexOut} onToast={onToast} />
          </div>
          <div className="tool-row">
            <span className="tool-result">{rgbOut}</span>
            <CopyButton text={rgbOut} onToast={onToast} />
          </div>
          <div className="tool-row">
            <span className="tool-result">{hslOut}</span>
            <CopyButton text={hslOut} onToast={onToast} />
          </div>
        </>
      ) : (
        <div className="tool-hint">认 #abc / #aabbcc / rgb(r, g, b)</div>
      )}
    </div>
  )
}

/* ---- UUID ---- */

function UuidTool({ onToast }: { onToast: Toast }) {
  const [list, setList] = useState<string[]>([])
  const gen = (count: number): void => {
    const fresh = Array.from({ length: count }, () => crypto.randomUUID())
    setList((prev) => [...fresh, ...prev].slice(0, 8))
  }
  return (
    <div className="tool-stack">
      <div className="tool-row">
        <button className="ghost" onClick={() => gen(1)}>生成一个</button>
        <button className="ghost" onClick={() => gen(5)}>×5</button>
        <button className="ghost" onClick={() => setList([])}>清空</button>
      </div>
      {list.map((id) => (
        <div className="tool-row" key={id}>
          <span className="tool-result tool-result--mono">{id}</span>
          <CopyButton text={id} onToast={onToast} />
        </div>
      ))}
      {list.length === 0 ? <div className="tool-hint">crypto.randomUUID，v4 随机</div> : null}
    </div>
  )
}

/* ---- Base64 / URL ---- */

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function b64decode(text: string): string {
  const bin = atob(text.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function EncodeTool({ onToast }: { onToast: Toast }) {
  const [mode, setMode] = useState<'base64' | 'url'>('base64')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = (direction: 'encode' | 'decode'): void => {
    setError('')
    setOutput('')
    try {
      if (mode === 'base64') {
        setOutput(direction === 'encode' ? b64encode(input) : b64decode(input))
      } else {
        setOutput(direction === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input))
      }
    } catch {
      setError(mode === 'base64' ? '不是合法的 Base64' : '含非法百分号转义')
    }
  }

  return (
    <div className="tool-stack">
      <div className="tool-row">
        <div className="seg">
          <button className={`seg__btn${mode === 'base64' ? ' seg__btn--on' : ''}`} onClick={() => setMode('base64')}>
            Base64
          </button>
          <button className={`seg__btn${mode === 'url' ? ' seg__btn--on' : ''}`} onClick={() => setMode('url')}>
            URL
          </button>
        </div>
      </div>
      <textarea
        className="tool-area"
        placeholder="输入文本"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
      />
      <div className="tool-row">
        <button className="ghost" onClick={() => run('encode')}>编码 →</button>
        <button className="ghost" onClick={() => run('decode')}>← 解码</button>
        <CopyButton text={output} onToast={onToast} />
        <span className="tool-hint">{error ? <em className="tool-error">{error}</em> : ''}</span>
      </div>
      {output ? <pre className="tool-out">{output}</pre> : null}
    </div>
  )
}

/* ---- 正则速测 ---- */

const REGEX_PRESETS: { label: string; pattern: string }[] = [
  { label: '邮箱', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+' },
  { label: 'URL', pattern: 'https?://[^\\s]+' },
  { label: 'IPv4', pattern: '(\\d{1,3}\\.){3}\\d{1,3}' },
  { label: '手机号', pattern: '1[3-9]\\d{9}' }
]

interface RegexResult {
  error?: string
  hits?: { start: number; end: number }[]
}

function RegexTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [text, setText] = useState('')

  const result = useMemo<RegexResult | null>(() => {
    if (!pattern) return null
    let re: RegExp
    try {
      re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
    } catch (e) {
      return { error: String(e).replace(/^[^:]*:\s*/, '') }
    }
    const hits: { start: number; end: number }[] = []
    let guard = 0
    let m = re.exec(text)
    while (m && guard < 2000) {
      guard++
      hits.push({ start: m.index, end: m.index + m[0].length })
      if (m[0].length === 0) re.lastIndex++
      m = re.exec(text)
    }
    return { hits }
  }, [pattern, flags, text])

  const segments = useMemo(() => {
    if (!result?.hits || result.hits.length === 0) return null
    const parts: { text: string; hit: boolean }[] = []
    let cursor = 0
    for (const hit of result.hits) {
      if (hit.start > cursor) parts.push({ text: text.slice(cursor, hit.start), hit: false })
      parts.push({ text: text.slice(hit.start, hit.end), hit: true })
      cursor = Math.max(cursor, hit.end)
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })
    return parts
  }, [result, text])

  return (
    <div className="tool-stack">
      <div className="tool-row">
        <span className="tool-slash">/</span>
        <input
          className="search search--inline"
          placeholder="正则表达式"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          spellCheck={false}
        />
        <span className="tool-slash">/</span>
        <input
          className="search search--flags"
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="tool-row">
        {REGEX_PRESETS.map((preset) => (
          <button key={preset.label} className="ghost" onClick={() => setPattern(preset.pattern)}>
            {preset.label}
          </button>
        ))}
      </div>
      <textarea
        className="tool-area"
        placeholder="测试文本"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {result?.error ? <div className="tool-hint"><em className="tool-error">{result.error}</em></div> : null}
      {segments ? (
        <pre className="tool-out regex-out">
          {segments.map((part, index) =>
            part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
          )}
        </pre>
      ) : null}
      {result?.hits ? <div className="tool-hint">{result.hits.length} 处匹配</div> : null}
    </div>
  )
}

/* ---- 哈希 ---- */

type HashAlgo = 'SHA-1' | 'SHA-256' | 'SHA-512'

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function HashTool({ onToast }: { onToast: Toast }) {
  const [algo, setAlgo] = useState<HashAlgo>('SHA-256')
  const [text, setText] = useState('')
  const [digest, setDigest] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!text) {
        setDigest('')
        setSource('')
        return
      }
      void crypto.subtle.digest(algo, new TextEncoder().encode(text)).then((buf) => {
        if (!cancelled) {
          setDigest(toHex(buf))
          setSource('文本')
        }
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [text, algo])

  const hashFile = async (file: File): Promise<void> => {
    if (file.size > 200 * 1024 * 1024) {
      onToast('文件超过 200MB，不读了')
      return
    }
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      setDigest(toHex(await crypto.subtle.digest(algo, buf)))
      setSource(file.name)
    } catch {
      onToast('文件读取失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool-stack">
      <div className="tool-row">
        <div className="seg">
          {(['SHA-1', 'SHA-256', 'SHA-512'] as HashAlgo[]).map((a) => (
            <button key={a} className={`seg__btn${algo === a ? ' seg__btn--on' : ''}`} onClick={() => setAlgo(a)}>
              {a.replace('SHA-', 'SHA')}
            </button>
          ))}
        </div>
        <label className="ghost ghost--file">
          选文件
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void hashFile(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <textarea
        className="tool-area"
        placeholder="或直接粘贴文本（自动计算）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {digest ? (
        <div className="tool-row">
          <span className="tool-hint">
            {source} · {busy ? '计算中…' : digest}
          </span>
          <CopyButton text={digest} onToast={onToast} />
        </div>
      ) : null}
    </div>
  )
}

/* ---- 文本统计 ---- */

function StatsTool() {
  const [text, setText] = useState('')
  const stats = useMemo(() => {
    const lines = text ? text.split(/\r\n|\r|\n/).length : 0
    const bytes = new TextEncoder().encode(text).length
    return {
      chars: text.length,
      noSpace: text.replace(/\s/g, '').length,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      lines,
      bytes
    }
  }, [text])

  const cells: { label: string; value: number }[] = [
    { label: '字符', value: stats.chars },
    { label: '非空白', value: stats.noSpace },
    { label: '单词', value: stats.words },
    { label: '行数', value: stats.lines },
    { label: 'UTF-8 字节', value: stats.bytes }
  ]

  return (
    <div className="tool-stack">
      <textarea
        className="tool-area tool-area--tall"
        placeholder="粘贴文本即时统计"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="stat-grid">
        {cells.map((cell) => (
          <div className="stat-cell" key={cell.label}>
            <div className="stat-cell__value">{cell.value.toLocaleString('zh-CN')}</div>
            <div className="stat-cell__label">{cell.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---- 面板入口 ---- */

export function ToolsPanel({ onToast }: { onToast: Toast }) {
  const [tool, setTool] = useState<ToolId>('json')

  return (
    <div className="panel">
      <div className="tool-chips">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            className={`tool-chip${tool === item.id ? ' tool-chip--on' : ''}`}
            onClick={() => setTool(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="tool-body">
        {tool === 'json' ? <JsonTool onToast={onToast} /> : null}
        {tool === 'epoch' ? <EpochTool onToast={onToast} /> : null}
        {tool === 'color' ? <ColorTool onToast={onToast} /> : null}
        {tool === 'uuid' ? <UuidTool onToast={onToast} /> : null}
        {tool === 'encode' ? <EncodeTool onToast={onToast} /> : null}
        {tool === 'regex' ? <RegexTool /> : null}
        {tool === 'hash' ? <HashTool onToast={onToast} /> : null}
        {tool === 'stats' ? <StatsTool /> : null}
      </div>
    </div>
  )
}
