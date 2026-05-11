import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { SplitSquareHorizontal, SplitSquareVertical, X } from 'lucide-react'
import { cn } from './ui'
import { TerminalPane } from './TerminalPane'
import { SftpPane } from './SftpPane'
import type { PaneNode, LeafPane } from '../stores/app'
import type { AppSettings } from '../ipc'

interface Props {
  node: PaneNode
  tabId: string
  activePaneId: string
  settings: AppSettings
  onSplit: (paneId: string, direction: 'horizontal' | 'vertical') => void
  onClose: (paneId: string) => void
  onFocus: (paneId: string) => void
}

function statusLabel(status: LeafPane['status']): string {
  switch (status) {
    case 'connecting': return '接続中…'
    case 'reconnecting': return '再接続中…'
    case 'error': return 'エラー'
    case 'closed': return '切断'
    case 'ready': return '接続済'
    default: return ''
  }
}

function StatusBadge({ status }: { status: LeafPane['status'] }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full shrink-0',
        status === 'ready'
          ? 'bg-emerald-400'
          : status === 'connecting'
            ? 'bg-amber-400 animate-pulse'
            : status === 'reconnecting'
              ? 'bg-orange-400 animate-pulse'
              : status === 'error'
                ? 'bg-rose-400'
                : 'bg-zinc-500'
      )}
      title={statusLabel(status)}
    />
  )
}

export function PaneRenderer({ node, tabId, activePaneId, settings, onSplit, onClose, onFocus }: Props) {
  if (node.kind === 'split') {
    return (
      <PanelGroup
        direction={node.direction === 'horizontal' ? 'horizontal' : 'vertical'}
        className="h-full w-full"
      >
        {node.children.flatMap((child, idx) => {
          const childId = child.kind === 'leaf' ? child.paneId : child.splitId
          const elements = [
            <Panel key={childId} defaultSize={node.sizes[idx] ?? 50} minSize={15}>
              <PaneRenderer
                node={child}
                tabId={tabId}
                activePaneId={activePaneId}
                settings={settings}
                onSplit={onSplit}
                onClose={onClose}
                onFocus={onFocus}
              />
            </Panel>,
          ]
          if (idx < node.children.length - 1) {
            elements.push(
              <PanelResizeHandle
                key={`resize-${childId}`}
                className={cn(
                  node.direction === 'horizontal'
                    ? 'w-1 bg-border hover:bg-accent transition-colors'
                    : 'h-1 bg-border hover:bg-accent transition-colors'
                )}
              />
            )
          }
          return elements
        })}
      </PanelGroup>
    )
  }

  // leaf
  const leaf = node
  const isActive = activePaneId === leaf.paneId

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden border-2 transition-colors',
        isActive ? 'border-accent' : 'border-transparent'
      )}
      onClick={() => onFocus(leaf.paneId)}
    >
      {/* Pane header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-bg-soft px-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge status={leaf.status} />
          <span className="truncate text-fg-mute">{statusLabel(leaf.status)}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onSplit(leaf.paneId, 'horizontal') }}
            title="右に分割"
            className="rounded p-0.5 text-fg-mute hover:bg-bg-mute hover:text-fg"
          >
            <SplitSquareHorizontal size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSplit(leaf.paneId, 'vertical') }}
            title="下に分割"
            className="rounded p-0.5 text-fg-mute hover:bg-bg-mute hover:text-fg"
          >
            <SplitSquareVertical size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(leaf.paneId) }}
            title="閉じる"
            className="rounded p-0.5 text-fg-mute hover:bg-bg-mute hover:text-rose-400"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {leaf.handle && (leaf.status === 'ready' || leaf.status === 'reconnecting') ? (
          <PanelGroup direction="horizontal" className="flex-1">
            <Panel defaultSize={60} minSize={20}>
              <TerminalPane
                handle={leaf.handle}
                settings={settings}
                onClose={() => onClose(leaf.paneId)}
              />
            </Panel>
            <PanelResizeHandle className="w-1 bg-border hover:bg-accent transition-colors" />
            <Panel defaultSize={40} minSize={15}>
              <SftpPane
                handle={leaf.handle}
                theme={settings.theme === 'light' ? 'vs' : 'vs-dark'}
              />
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex flex-1 items-center justify-center text-fg-mute text-sm">
            {leaf.status === 'connecting' && '接続中…'}
            {leaf.status === 'idle' && '待機中'}
            {leaf.status === 'closed' && '接続が閉じられました'}
            {leaf.status === 'error' && (
              <span className="text-rose-400">
                エラー{leaf.errorMessage ? `: ${leaf.errorMessage}` : ''}
              </span>
            )}
            {leaf.status === 'reconnecting' && '再接続中…'}
          </div>
        )}
      </div>
    </div>
  )
}
