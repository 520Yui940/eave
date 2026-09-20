import { useState } from 'react'
import type { TimerKind } from './timers'
import {
  addTimer,
  formatTimer,
  isRunning,
  remainingMs,
  removeTimer,
  resetTimer,
  toggleTimer,
  useTimers
} from './timers'
import { PauseIcon, PlayIcon, TrashIcon } from './icons'

const KINDS: Array<{ kind: TimerKind; label: string }> = [
  { kind: 'countdown', label: '倒计时' },
  { kind: 'stopwatch', label: '秒表' },
  { kind: 'pomodoro', label: '番茄钟' }
]

const PRESETS = [3, 5, 10, 25]

export function TimersPanel() {
  const { items } = useTimers()
  const [kind, setKind] = useState<TimerKind>('countdown')
  const [minutes, setMinutes] = useState('5')

  const create = (): void => {
    const mins = Math.max(1, Math.min(600, Number(minutes) || 5))
    addTimer(kind, '', mins)
  }

  return (
    <div className="panel">
      <div className="timer-toolbar">
        <div className="seg">
          {KINDS.map(({ kind: value, label }) => (
            <button
              key={value}
              className={`seg__btn${kind === value ? ' seg__btn--on' : ''}`}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {kind === 'countdown' ? (
          <span className="timer-minutes">
            <input
              className="search timer-minutes__input"
              inputMode="numeric"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value.replace(/[^\d]/g, ''))}
              spellCheck={false}
              aria-label="分钟数"
            />
            分钟
          </span>
        ) : null}
        <button className="ghost" onClick={create}>
          新建
        </button>
      </div>

      {kind === 'countdown' ? (
        <div className="timer-presets">
          {PRESETS.map((preset) => (
            <button key={preset} className="chip" onClick={() => addTimer('countdown', '', preset)}>
              {preset} 分钟
            </button>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="empty">
          <span>没有进行中的计时</span>
          <span style={{ fontSize: 10 }}>建一个，胶囊上会直接显示倒计时</span>
        </div>
      ) : (
        <div className="timer-list">
          {items.map((item) => {
            const running = isRunning(item)
            const remaining = remainingMs(item)
            return (
              <div className={`timer-item${running ? '' : ' timer-item--paused'}`} key={item.id}>
                <div className="timer-item__main">
                  <div className="timer-item__time">{formatTimer(remaining)}</div>
                  <div className="timer-item__meta">
                    {item.kind === 'pomodoro' ? (
                      <span className={`timer-phase${item.phase === 'work' ? '' : ' timer-phase--break'}`}>
                        {item.phase === 'work' ? '🍅 专注' : '☕ 休息'}
                      </span>
                    ) : null}
                    <span>{item.label}</span>
                    {item.kind === 'pomodoro' ? <span>· 第 {item.rounds + 1} 轮</span> : null}
                    {!running ? <span>· 已暂停</span> : null}
                  </div>
                </div>
                <div className="timer-item__actions">
                  <button
                    className="icon-btn"
                    title={running ? '暂停' : '继续'}
                    onClick={() => toggleTimer(item.id)}
                  >
                    {running ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button className="icon-btn" title="重置" onClick={() => resetTimer(item.id)}>
                    ↺
                  </button>
                  <button
                    className="icon-btn"
                    title="删除"
                    onClick={() => removeTimer(item.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
