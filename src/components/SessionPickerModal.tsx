import { Server } from 'lucide-react'
import type { SessionProfile } from '../ipc'
import { Modal } from './Modal'

interface Props {
  open: boolean
  sessions: SessionProfile[]
  onSelect: (session: SessionProfile) => void
  onCancel: () => void
}

export function SessionPickerModal({ open, sessions, onSelect, onCancel }: Props) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onCancel() }}
      title="接続するセッションを選択"
      width="max-w-sm"
    >
      <div className="max-h-80 overflow-auto">
        {sessions.length === 0 && (
          <p className="py-4 text-center text-xs text-fg-mute">セッションがありません</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s)}
            className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-bg-mute"
          >
            <Server size={14} className="shrink-0 text-accent" />
            <div className="min-w-0">
              <div className="truncate font-medium">{s.name}</div>
              <div className="truncate text-xs text-fg-mute">{s.host}:{s.port ?? 22}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
