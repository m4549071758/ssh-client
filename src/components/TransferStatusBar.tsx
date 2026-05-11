import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { api } from '../ipc'
import type { TransferProgressEvent, TransferCompleteEvent } from '../ipc'

interface TransferEntry {
  transferId: string
  kind: 'upload' | 'download'
  progress: TransferProgressEvent | null
  complete: TransferCompleteEvent | null
  /** 成功時の自動消去タイマー */
  autoRemoveTimer: ReturnType<typeof setTimeout> | null
}

interface Props {
  handle: string
  /** 外部から転送を登録するためのコールバック登録 */
  onRegister: (register: (transferId: string, kind: 'upload' | 'download') => void) => void
}

/**
 * SFTPペイン下部に表示する転送ステータスバー。
 * アクティブな転送を並べて進捗バー・キャンセルボタンを提供する。
 */
export function TransferStatusBar({ onRegister }: Props) {
  const [transfers, setTransfers] = useState<Map<string, TransferEntry>>(new Map())
  // cleanup functions per transferId
  const cleanupRefs = useRef<Map<string, () => void>>(new Map())

  const removeEntry = useCallback((transferId: string) => {
    setTransfers((prev) => {
      const next = new Map(prev)
      const entry = next.get(transferId)
      if (entry?.autoRemoveTimer) clearTimeout(entry.autoRemoveTimer)
      next.delete(transferId)
      return next
    })
    const cleanup = cleanupRefs.current.get(transferId)
    if (cleanup) {
      cleanup()
      cleanupRefs.current.delete(transferId)
    }
  }, [])

  const register = useCallback(
    (transferId: string, kind: 'upload' | 'download') => {
      setTransfers((prev) => {
        const next = new Map(prev)
        next.set(transferId, {
          transferId,
          kind,
          progress: null,
          complete: null,
          autoRemoveTimer: null
        })
        return next
      })

      const offProgress = api.transfer.onProgress(transferId, (p) => {
        setTransfers((prev) => {
          const next = new Map(prev)
          const entry = next.get(transferId)
          if (!entry) return prev
          next.set(transferId, { ...entry, progress: p })
          return next
        })
      })

      const offComplete = api.transfer.onComplete(transferId, (c) => {
        setTransfers((prev) => {
          const next = new Map(prev)
          const entry = next.get(transferId)
          if (!entry) return prev

          // 成功時は 3 秒後に自動消去、失敗・キャンセルは手動消去
          let timer: ReturnType<typeof setTimeout> | null = null
          if (c.failedFiles.length === 0 && !c.cancelled) {
            timer = setTimeout(() => removeEntry(transferId), 3000)
          }
          next.set(transferId, { ...entry, complete: c, autoRemoveTimer: timer })
          return next
        })
      })

      const offError = api.transfer.onError(transferId, (msg) => {
        setTransfers((prev) => {
          const next = new Map(prev)
          const entry = next.get(transferId)
          if (!entry) return prev
          // エラー時は失敗扱いの complete として扱う
          next.set(transferId, {
            ...entry,
            complete: {
              transferId,
              successCount: 0,
              failedFiles: [{ path: '(unknown)', error: msg }],
              cancelled: false
            }
          })
          return next
        })
      })

      cleanupRefs.current.set(transferId, () => {
        offProgress()
        offComplete()
        offError()
      })
    },
    [removeEntry]
  )

  // 親に register 関数を渡す
  useEffect(() => {
    onRegister(register)
  }, [onRegister, register])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      for (const cleanup of cleanupRefs.current.values()) cleanup()
    }
  }, [])

  const entries = Array.from(transfers.values())
  if (entries.length === 0) return null

  return (
    <div className="shrink-0 border-t border-border bg-bg-soft px-2 py-1.5 space-y-1">
      {entries.map((entry) => (
        <TransferRow
          key={entry.transferId}
          entry={entry}
          onCancel={() => {
            api.transfer.cancel(entry.transferId).catch(() => undefined)
          }}
          onClose={() => removeEntry(entry.transferId)}
          onRetry={async () => {
            try {
              const newId = await api.transfer.retryFailed(entry.transferId)
              if (newId) {
                register(newId, entry.kind)
                removeEntry(entry.transferId)
              }
            } catch {
              /* ignore */
            }
          }}
        />
      ))}
    </div>
  )
}

function TransferRow({
  entry,
  onCancel,
  onClose,
  onRetry
}: {
  entry: TransferEntry
  onCancel: () => void
  onClose: () => void
  onRetry: () => void
}) {
  const { kind, progress, complete } = entry
  const kindIcon = kind === 'upload' ? '↑' : '↓'

  // 完了状態
  if (complete) {
    const hasError = complete.failedFiles.length > 0
    const wasCancelled = complete.cancelled

    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-mute w-3">{kindIcon}</span>
        {wasCancelled ? (
          <span className="text-fg-mute">キャンセル済み</span>
        ) : hasError ? (
          <span className="text-rose-400 truncate">
            失敗 {complete.failedFiles.length} 件: {complete.failedFiles[0].error}
          </span>
        ) : (
          <span className="text-green-400">{complete.successCount} 件 完了</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {hasError && (
            <button
              onClick={onRetry}
              title="失敗ファイルだけ再試行"
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-fg-mute hover:bg-bg-mute hover:text-fg"
            >
              <RefreshCw size={11} />
              再試行
            </button>
          )}
          <button onClick={onClose} className="text-fg-mute hover:text-fg p-0.5">
            <X size={12} />
          </button>
        </div>
      </div>
    )
  }

  // 進捗中
  const p = progress
  const pct =
    p && p.totalBytes > 0
      ? Math.min(100, Math.round((p.transferredBytes / p.totalBytes) * 100))
      : null

  // アクティブファイル名 (最大 40 文字)
  const activeFile =
    p && p.active.length > 0
      ? truncatePath(p.active[0].path, 40)
      : null

  return (
    <div className="flex items-center gap-2 text-xs min-w-0">
      <span className="text-fg-mute w-3 shrink-0">{kindIcon}</span>
      <div className="flex-1 min-w-0">
        {/* 進捗バー */}
        <div className="h-1.5 w-full rounded-full bg-bg-mute overflow-hidden mb-0.5">
          <div
            className="h-full rounded-full bg-accent transition-all duration-100"
            style={{ width: pct !== null ? `${pct}%` : '0%' }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-fg-mute truncate min-w-0">
            {activeFile ?? '準備中...'}
          </span>
          <span className="text-fg-mute shrink-0 tabular-nums">
            {p ? `${p.completed}/${p.total}` : ''}
            {pct !== null ? ` (${pct}%)` : ''}
          </span>
        </div>
      </div>
      <button
        onClick={onCancel}
        className="shrink-0 text-fg-mute hover:text-rose-400 p-0.5"
        title="キャンセル"
      >
        <X size={12} />
      </button>
    </div>
  )
}

function truncatePath(p: string, maxLen: number): string {
  const name = p.split(/[\\/]/).pop() ?? p
  if (name.length <= maxLen) return name
  return '...' + name.slice(-(maxLen - 3))
}
