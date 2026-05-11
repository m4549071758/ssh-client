import { X } from 'lucide-react'
import { cn } from './ui'
import type { Tab } from '../stores/app'

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose
}: {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 border-b border-border bg-bg-soft px-1">
      {tabs.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={cn(
            'group flex h-8 cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-3 text-xs',
            t.id === activeId ? 'border-border bg-bg text-fg' : 'border-transparent bg-bg-soft text-fg-mute hover:bg-bg-mute'
          )}
        >
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              t.status === 'ready'
                ? 'bg-emerald-400'
                : t.status === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : t.status === 'reconnecting'
                    ? 'bg-orange-400 animate-pulse'
                    : t.status === 'error'
                      ? 'bg-rose-400'
                      : 'bg-zinc-500'
            )}
          />
          <span className="max-w-[180px] truncate">{t.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
            className="text-fg-mute hover:text-fg"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
