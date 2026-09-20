/**
 * 计时器 / 秒表 / 番茄钟 —— 纯渲染层实现。
 *
 * 设计约束：
 * - 单例 store，胶囊态与面板共用一份状态
 * - 全局只有一条 500ms 定时器；没有活动计时器时整条停掉
 * - 持久化走 localStorage，重启后倒计时按 endAt 绝对时间恢复
 * - 提示音用 AudioContext oscillator 现造，零素材文件
 */

import { useEffect, useState } from 'react'

export type TimerKind = 'countdown' | 'stopwatch' | 'pomodoro'
export type PomodoroPhase = 'work' | 'break'

export interface TimerItem {
  id: string
  kind: TimerKind
  label: string
  /** 倒计时总时长（ms）；秒表/番茄钟为 0 */
  duration: number
  /** 倒计时结束时刻（绝对时间戳）；暂停时为 null */
  endAt: number | null
  /** 暂停期间冻结的剩余/已累计时长（ms） */
  elapsedBase: number
  /** 当前段开始时刻（秒表/番茄钟运行中），null = 暂停；倒计时恒为 null */
  segmentStart: number | null
  /** 番茄钟：当前阶段 */
  phase: PomodoroPhase
  /** 番茄钟：已完成的专注轮数 */
  rounds: number
}

const WORK_MS = 25 * 60_000
const BREAK_MS = 5 * 60_000
const LONG_BREAK_MS = 15 * 60_000
const STORE_KEY = 'eave.timers.v1'

interface TimerSnapshot {
  items: TimerItem[]
  /** 最近一次自然归零事件（供胶囊闪烁/toast），读后用 clearExpired 消费 */
  expired: { id: string; label: string; kind: TimerKind; at: number } | null
}

let state: TimerSnapshot = load()
const listeners = new Set<() => void>()
let ticker: number | null = null
let audioCtx: AudioContext | null = null

// 从 localStorage 恢复后若有在跑的计时器（重启期间归零的交给 tick 收尾），立即续上心跳
if (needsTicker(state.items)) ensureTicker()

function load(): TimerSnapshot {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { items: [], expired: null }
    const parsed = JSON.parse(raw) as Partial<TimerSnapshot>
    if (!Array.isArray(parsed.items)) return { items: [], expired: null }
    return { items: parsed.items, expired: null }
  } catch {
    return { items: [], expired: null }
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ items: state.items }))
  } catch {
    /* quota/full：计时器仍在内存里跑 */
  }
}

function emit(): void {
  listeners.forEach((listener) => listener())
}

/** 短哔两声：800ms+1200ms 正弦波，0.15s 衰减。无音频素材；是否响由调用方按设置决定 */
export function playChime(): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    const ctx = audioCtx
    ;[880, 1175].forEach((freq, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const t0 = ctx.currentTime + index * 0.18
      gain.gain.setValueAtTime(0.001, t0)
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.18)
    })
  } catch {
    /* autoplay policy / 无音频设备：静默失败可接受 */
  }
}

function markExpired(item: TimerItem): void {
  state = { ...state, expired: { id: item.id, label: item.label, kind: item.kind, at: Date.now() } }
}

function tick(): void {
  const now = Date.now()
  let eventful = false

  const items = state.items.map((item) => {
    if (item.endAt === null || item.endAt > now) return item

    if (item.kind === 'countdown') {
      eventful = true
      markExpired(item)
      return { ...item, endAt: null, elapsedBase: 0 }
    }

    // 番茄钟：阶段结束自动切相并续跑
    const finishedWork = item.phase === 'work'
    const rounds = finishedWork ? item.rounds + 1 : item.rounds
    const nextPhase: PomodoroPhase = finishedWork ? 'break' : 'work'
    const duration = nextPhase === 'work' ? WORK_MS : rounds % 4 === 0 ? LONG_BREAK_MS : BREAK_MS
    eventful = true
    markExpired(item)
    return { ...item, phase: nextPhase, rounds, endAt: now + duration, duration }
  })

  state = { ...state, items }
  // 有活动计时器时 ticker 2Hz 全量广播（面板秒级刷新靠它）；事件才落盘
  emit()
  if (eventful) persist()

  if (eventful && !needsTicker(items)) stopTicker()
}

function ensureTicker(): void {
  if (ticker !== null) return
  ticker = window.setInterval(tick, 500)
}

function stopTicker(): void {
  if (ticker === null) return
  window.clearInterval(ticker)
  ticker = null
}

function commit(items: TimerItem[]): void {
  state = { ...state, items }
  emit()
  persist()
  if (needsTicker(items)) ensureTicker()
  else stopTicker()
}

/** 秒表跑的是 segmentStart 不是 endAt，两者都要算「需要心跳」 */
function needsTicker(items: TimerItem[]): boolean {
  return items.some((item) => item.endAt !== null || item.segmentStart !== null)
}

export function subscribeTimers(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTimers(): TimerSnapshot {
  return state
}

export function addTimer(kind: TimerKind, label: string, minutes: number): void {
  const now = Date.now()
  const item: TimerItem = {
    id: `t${now}${Math.floor(Math.random() * 1000)}`,
    kind,
    label:
      label.trim() ||
      (kind === 'pomodoro' ? '番茄钟' : kind === 'stopwatch' ? '秒表' : '倒计时'),
    duration: kind === 'countdown' ? minutes * 60_000 : 0,
    endAt: kind === 'countdown' ? now + minutes * 60_000 : kind === 'pomodoro' ? now + WORK_MS : null,
    elapsedBase: 0,
    segmentStart: kind === 'stopwatch' ? now : null,
    phase: 'work',
    rounds: 0
  }
  commit([item, ...state.items].slice(0, 8))
}

export function removeTimer(id: string): void {
  commit(state.items.filter((item) => item.id !== id))
}

export function toggleTimer(id: string): void {
  const now = Date.now()
  commit(
    state.items.map((item) => {
      if (item.id !== id) return item
      if (item.kind === 'countdown') {
        if (item.endAt !== null) {
          // 暂停：剩余时长冻结进 elapsedBase
          return { ...item, endAt: null, elapsedBase: Math.max(0, item.endAt - now) }
        }
        return { ...item, endAt: now + item.elapsedBase }
      }
      if (item.segmentStart !== null) {
        // 暂停：冻结已累计时长
        return {
          ...item,
          elapsedBase: item.elapsedBase + (now - item.segmentStart),
          segmentStart: null
        }
      }
      return { ...item, segmentStart: now }
    })
  )
}

/** 秒表/番茄钟归零重跑；倒计时恢复满时长并立即运行 */
export function resetTimer(id: string): void {
  const now = Date.now()
  commit(
    state.items.map((item) => {
      if (item.id !== id) return item
      if (item.kind === 'countdown') {
        return { ...item, endAt: now + item.duration, elapsedBase: item.duration }
      }
      if (item.kind === 'stopwatch') {
        return { ...item, elapsedBase: 0, segmentStart: now }
      }
      return { ...item, phase: 'work', rounds: 0, endAt: now + WORK_MS, elapsedBase: 0 }
    })
  )
}

export function clearExpired(): void {
  if (!state.expired) return
  state = { ...state, expired: null }
  emit()
}

export function remainingMs(item: TimerItem, now = Date.now()): number {
  if (item.kind === 'countdown') {
    if (item.endAt !== null) return Math.max(0, item.endAt - now)
    return Math.max(0, item.elapsedBase)
  }
  const running = item.segmentStart !== null ? now - item.segmentStart : 0
  return item.elapsedBase + running
}

export function isRunning(item: TimerItem): boolean {
  return item.kind === 'countdown' ? item.endAt !== null : item.segmentStart !== null
}

export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 面板/胶囊共用订阅；只在 store 变化时重渲染 */
export function useTimers(): TimerSnapshot {
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(getTimers)
  useEffect(() => subscribeTimers(() => setSnapshot(getTimers())), [])
  return snapshot
}

/** 胶囊态：返回「最该上胶囊」的运行中计时器 */
export function useActiveTimer(): TimerItem | null {
  const { items } = useTimers()
  return items.find((item) => isRunning(item)) ?? null
}
