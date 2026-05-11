import { Modal } from './Modal'
import { Button } from './ui'
import type { HostKeyDecision, HostKeyPromptInfo } from '../ipc'

export function HostKeyPrompt({
  open,
  info,
  onDecision
}: {
  open: boolean
  info: HostKeyPromptInfo | null
  onDecision: (decision: HostKeyDecision) => void
}) {
  if (!info) return null

  const isMismatch = !!info.previousFingerprint

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onDecision('reject')}
      title={isMismatch ? '⚠️ ホスト鍵の変更を検出' : '初回接続 — ホスト鍵の確認'}
      width="max-w-xl"
    >
      {isMismatch ? (
        <div className="mb-4 rounded-md border border-rose-500/50 bg-rose-900/20 p-3 text-sm text-rose-300">
          <p className="font-semibold">⚠️ ホスト鍵が変更されています！</p>
          <p className="mt-1">MITM (中間者) 攻撃の可能性があります。本当にサーバ側の鍵が変わった場合のみ続行してください。</p>
        </div>
      ) : (
        <p className="mb-4 text-sm text-fg-mute">
          <strong>{info.host}:{info.port}</strong> への初回接続です。
          フィンガープリントを確認し、保存するか拒否するか選択してください。
        </p>
      )}

      <div className="mb-4 space-y-2 text-sm">
        {isMismatch && (
          <div>
            <span className="text-xs text-fg-mute">登録済みフィンガープリント (旧)</span>
            <code className="mt-0.5 block break-all rounded bg-bg-mute px-2 py-1 text-xs text-rose-300">
              {info.previousFingerprint}
            </code>
          </div>
        )}
        <div>
          <span className="text-xs text-fg-mute">
            {isMismatch ? 'サーバから提示されたフィンガープリント (新)' : 'サーバのフィンガープリント'}
          </span>
          <code className="mt-0.5 block break-all rounded bg-bg-mute px-2 py-1 text-xs text-fg">
            {info.fingerprint}
          </code>
        </div>
      </div>

      {isMismatch ? (
        <div className="flex justify-end gap-2">
          <Button variant="primary" onClick={() => onDecision('reject')}>
            拒否 (安全)
          </Button>
          <Button variant="danger" onClick={() => onDecision('replace')}>
            古い鍵を破棄して続行 (危険)
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onDecision('reject')}>
            拒否
          </Button>
          <Button variant="primary" onClick={() => onDecision('accept')}>
            保存して続行
          </Button>
        </div>
      )}
    </Modal>
  )
}
