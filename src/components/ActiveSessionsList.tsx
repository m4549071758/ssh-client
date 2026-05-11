import { useEffect, useState } from 'react'
import { Activity, ChevronDown, ChevronRight, X } from 'lucide-react'
import { collectLeaves, type LeafPane, type Tab } from '../stores/app'

interface Props {
  tabs: Tab[]
  sessions: { id: string; name: string }[]
  activeTabId: string | null
  onJump: (tabId: string, paneId: string) => void
  onClose: (tabId: string, paneId: string) => void
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function statusColor(status: LeafPane['status']): string {
  switch (status) {
    case 'ready': return 'text-emerald-400'
    case 'connecting': return 'text-amber-400'
    case 'reconnecting': return 'text-orange-400'
    case 'error': return 'text-rose-400'
    case 'closed': return 'text-zinc-500'
    default: return 'text-fg-mute'
  }
}

/** サイドバー下部のアクティブセッション一覧。 */
export function ActiveSessionsList({ tabs, sessions, activeTabId, onJump, onClose }: Props): JSX.Element | null {
  const [expanded, setExpanded] = useState(true)
  const [now, setNow] = useState(Date.now())

  // 1秒ごとに再描画して経過時間を更新
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // 全タブの leaf を収集
  const items: { tabId: string; tabName: string; leaf: LeafPane }[] = []
  for (const tab of tabs) {
    for (const leaf of collectLeaves(tab.layout)) {
      items.push({ tabId: tab.id, tabName: tab.name, leaf })
    }
  }
  // ready / reconnecting / connecting のみ表示 (closed / error は除外)
  const activeItems = items.filter((it) =>
    it.leaf.status === 'ready' || it.leaf.status === 'reconnecting' || it.leaf.status === 'connecting'
  )

  if (activeItems.length === 0) return null

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-xs uppercase text-fg-mute hover:bg-bg-mute"
      >
        <span className="flex items-center gap-1">
          <Activity size={11} />
          アクティブ ({activeItems.length})
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && (
        <div className="max-h-40 overflow-auto">
          {activeItems.map(({ tabId, leaf, tabName }) => {
            const session = sessions.find((s) => s.id === leaf.sessionId)
            const sessionName = session?.name ?? tabName
            const duration = leaf.connectedAt ? formatDuration(now - leaf.connectedAt) : '—'
            const isActive = tabId === activeTabId
            return (
              <div
                key={leaf.paneId}
                className={`group flex items-center gap-1 px-3 py-1 text-xs hover:bg-bg-mute ${isActive ? 'bg-bg-mute/50' : ''}`}
              >
                <button
                  onClick={() => onJump(tabId, leaf.paneId)}
                  className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
                  title={leaf.status}
                >
                  <span className={`text-[8px] ${statusColor(leaf.status)}`}>●</span>
                  <span className="truncate">{sessionName}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-fg-mute">{duration}</span>
                </button>
                <button
                  onClick={() => onClose(tabId, leaf.paneId)}
                  className="rounded p-0.5 text-fg-mute opacity-0 hover:text-rose-400 group-hover:opacity-100"
                  title="切断"
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
