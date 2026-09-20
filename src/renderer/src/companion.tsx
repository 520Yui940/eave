import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import companionOpen from './assets/companion-open.png'
import companionClosed from './assets/companion-closed.png'

/**
 * 岛内住客（0.5.0）：B 路实现——AI 立绘双帧（睁/闭眼）+ CSS transform/opacity 动画。
 * 架构预留 C 路：mood 是唯一的状态接口，将来换 Live2D 引擎时只重写 Companion 的渲染体，
 * 状态推导（useCompanion）和 App 的事件接线原样保留。
 * 所有循环动画走 transform/opacity（合成器纪律），内存 ≈ 两张 512 PNG 解码 ≈ 1.7MB。
 */

export type CompanionMood = 'idle' | 'groove' | 'sleepy' | 'sleep' | 'cheer' | 'peek' | 'pat'

export interface CompanionInput {
  mediaPlaying: boolean
  charging: boolean
  night: boolean
  timerPulse: boolean
  clipPulse: boolean
}

/** 事件 → 心情：优先级 深夜 > 欢呼 > 摸头 > 打拍子 > 打瞌睡 > 探头 > 待机 */
function deriveMood(
  { mediaPlaying, charging, night, timerPulse, clipPulse }: CompanionInput,
  patActive: boolean
): CompanionMood {
  if (night) return 'sleep'
  if (timerPulse) return 'cheer'
  if (patActive) return 'pat'
  if (mediaPlaying) return 'groove'
  if (charging) return 'sleepy'
  if (clipPulse) return 'peek'
  return 'idle'
}

export function useCompanion(input: CompanionInput) {
  const [blinking, setBlinking] = useState(false)
  const [patKey, setPatKey] = useState(0)
  const [patActive, setPatActive] = useState(false)
  const patTimer = useRef<number | null>(null)

  const mood = deriveMood(input, patActive)

  // 眨眼：随机 2.6~5.4s 一次，闭眼 130ms；睡觉/欢呼时不眨（sleep 常闭，cheer 睁眼蹦）
  useEffect(() => {
    if (mood === 'sleep' || mood === 'cheer') {
      setBlinking(false)
      return
    }
    let closedTimer = 0
    const schedule = (): void => {
      const timer = window.setTimeout(() => {
        setBlinking(true)
        closedTimer = window.setTimeout(() => setBlinking(false), 130)
        schedule()
      }, 2600 + Math.random() * 2800)
      scheduleRef.current = timer
    }
    const scheduleRef = { current: 0 }
    schedule()
    return () => {
      window.clearTimeout(scheduleRef.current)
      window.clearTimeout(closedTimer)
    }
  }, [mood])

  const onPat = useCallback(() => {
    setPatKey((n) => n + 1)
    setPatActive(true)
    if (patTimer.current) window.clearTimeout(patTimer.current)
    patTimer.current = window.setTimeout(() => setPatActive(false), 900)
  }, [])

  useEffect(
    () => () => {
      if (patTimer.current) window.clearTimeout(patTimer.current)
    },
    []
  )

  return { mood, blinking, patKey, onPat }
}

/** 摸头冒出的爱心数量 */
const PAT_HEARTS = 3

export function Companion({
  mood,
  blinking,
  patKey,
  onPat,
  hidden,
  leftSide
}: {
  mood: CompanionMood
  blinking: boolean
  patKey: number
  onPat: () => void
  /** 展开态淡出：岛占满窗口时她「躲开」，回到胶囊态再出来 */
  hidden: boolean
  /** 媒体胶囊拉宽时换到左侧对称位 */
  leftSide: boolean
}) {
  const closedVisible = mood === 'sleep' || blinking
  const sleeping = mood === 'sleep' || mood === 'sleepy'

  return (
    <div
      className={[
        'companion',
        `companion--${mood}`,
        leftSide ? 'companion--left' : 'companion--right',
        hidden ? 'companion--hidden' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-eave-companion
      onClick={onPat}
      title="摸摸头"
    >
      <img className="companion__img" src={companionOpen} alt="" draggable={false} />
      <img
        className={`companion__img companion__img--closed${closedVisible ? ' companion__img--show' : ''}`}
        src={companionClosed}
        alt=""
        draggable={false}
      />
      {sleeping ? <span className="companion__bubble companion__zzz">z z</span> : null}
      {mood === 'groove' ? <span className="companion__bubble companion__note">♪</span> : null}
      {mood === 'cheer' ? (
        <>
          <span className="companion__bubble companion__spark">✦</span>
          <span className="companion__bubble companion__spark companion__spark--b">✧</span>
        </>
      ) : null}
      {mood === 'peek' ? <span className="companion__bubble companion__q">?</span> : null}
      {mood === 'pat'
        ? Array.from({ length: PAT_HEARTS }, (_, i) => (
            <span
              key={`${patKey}-${i}`}
              className="companion__bubble companion__heart"
              style={{ '--d': `${i * 0.16}s` } as CSSProperties}
            >
              ♥
            </span>
          ))
        : null}
    </div>
  )
}
