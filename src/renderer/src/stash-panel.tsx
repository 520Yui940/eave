import type { StashEntry } from '@shared/types'
import { BoxIcon } from './icons'
import { formatBytes, formatRelative } from './format'

export type StashActionType = 'remove' | 'clear' | 'copyPath' | 'reveal' | 'startDrag'

/**
 * 文件暂存架。拖入动作在 App.tsx 的岛体 drop 事件里接（面板开着时整面岛都是拖放区）。
 * 出栈四件：复制路径 / 拖出（startDrag）/ 打开所在文件夹 / 删除。
 */
export function StashPanel({
  entries,
  onAction
}: {
  entries: StashEntry[]
  onAction: (action: { type: StashActionType; id?: string }) => void
}) {
  const copiedBytes = entries.filter((e) => e.stored === 'copy').reduce((sum, e) => sum + e.sizeBytes, 0)

  return (
    <div className="panel">
      <div className="clip-toolbar">
        <span className="stash-summary">
          {entries.length > 0
            ? `${entries.length} 条 · 复制区 ${formatBytes(copiedBytes, 1)}`
            : '暂存架是空的'}
        </span>
        {entries.length > 0 ? (
          <button className="ghost" onClick={() => onAction({ type: 'clear' })}>
            清空
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <BoxIcon />
          <span>把面板打开着，直接把文件拖进岛里</span>
          <span style={{ fontSize: 10 }}>≤8MB 的文件会复制一份副本，大文件只记原路径</span>
        </div>
      ) : (
        <div className="clip-list">
          {entries.map((entry) => (
            <div className="clip-item" key={entry.id}>
              <span className="clip-item__thumb stash-thumb">
                {entry.kind === 'folder' ? '📁' : '📄'}
              </span>
              <div className="clip-item__body">
                <div className="clip-item__text">{entry.name}</div>
                <div className="clip-item__meta">
                  {entry.stored === 'copy' ? '已复制' : '引用原路径'} ·{' '}
                  {entry.kind === 'file' ? formatBytes(entry.sizeBytes, 1) : '文件夹'} ·{' '}
                  {formatRelative(entry.time)}
                </div>
              </div>
              <div className="clip-item__actions">
                <button
                  className="icon-btn"
                  title="复制路径"
                  onClick={() => onAction({ type: 'copyPath', id: entry.id })}
                >
                  ⧉
                </button>
                {entry.kind === 'file' ? (
                  <button
                    className="icon-btn"
                    title="按住拖到资源管理器 / 聊天窗口"
                    onClick={() => onAction({ type: 'startDrag', id: entry.id })}
                  >
                    ✥
                  </button>
                ) : null}
                <button
                  className="icon-btn"
                  title="打开所在文件夹"
                  onClick={() => onAction({ type: 'reveal', id: entry.id })}
                >
                  ↗
                </button>
                <button
                  className="icon-btn"
                  title="移出暂存架"
                  onClick={() => onAction({ type: 'remove', id: entry.id })}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
