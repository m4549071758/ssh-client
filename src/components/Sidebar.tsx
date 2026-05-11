import { ChevronRight, Edit2, KeyRound, Lock, Plus, Server, Settings as SettingsIcon, Trash2, Unlock } from 'lucide-react'
import type { SessionProfile, VaultStatus } from '../ipc'
import { Button, cn } from './ui'

interface Props {
  sessions: SessionProfile[]
  vaultStatus: VaultStatus | null
  onNewSession: () => void
  onEditSession: (s: SessionProfile) => void
  onDeleteSession: (s: SessionProfile) => void
  onConnect: (s: SessionProfile) => void
  onOpenVault: () => void
  onOpenSettings: () => void
}

export function Sidebar({
  sessions,
  vaultStatus,
  onNewSession,
  onEditSession,
  onDeleteSession,
  onConnect,
  onOpenVault,
  onOpenSettings
}: Props) {
  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-border bg-bg-soft">
      <div className="border-b border-border px-3 py-3">
        <h1 className="text-sm font-semibold tracking-wide">SSH Client</h1>
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs uppercase text-fg-mute">セッション</span>
        <button
          onClick={onNewSession}
          title="新規セッション"
          className="rounded p-1 text-fg-mute hover:bg-bg-mute hover:text-fg"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {sessions.length === 0 && (
          <p className="px-3 py-2 text-xs text-fg-mute">まだセッションがありません。+ から追加してください。</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className="group flex items-center justify-between gap-1 px-3 py-1.5 hover:bg-bg-mute"
          >
            <button
              onClick={() => onConnect(s)}
              className="flex flex-1 items-center gap-2 truncate text-left text-sm"
            >
              <Server size={14} className="shrink-0 text-accent" />
              <span className="truncate">{s.name}</span>
              <ChevronRight size={12} className="ml-auto text-fg-mute opacity-0 group-hover:opacity-100" />
            </button>
            <button
              onClick={() => onEditSession(s)}
              className="rounded p-1 text-fg-mute opacity-0 hover:text-fg group-hover:opacity-100"
              title="編集"
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={() => onDeleteSession(s)}
              className="rounded p-1 text-fg-mute opacity-0 hover:text-rose-400 group-hover:opacity-100"
              title="削除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-2">
        <Button variant="ghost" className="mb-1 w-full justify-start" onClick={onOpenVault}>
          {vaultStatus?.isUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
          <span>Vault {vaultStatus?.isUnlocked ? '(unlocked)' : ''}</span>
        </Button>
        <Button variant="ghost" className="w-full justify-start" onClick={onOpenSettings}>
          <SettingsIcon size={14} />
          <span>設定</span>
        </Button>
      </div>
    </aside>
  )
}
