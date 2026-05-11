import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Button, Field, Input } from './ui'

export interface QuickConnectTarget {
  username: string
  host: string
  port: number
  password?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnect: (target: QuickConnectTarget) => void
}

function parseTarget(input: string): Omit<QuickConnectTarget, 'password'> | null {
  const m = input.trim().match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/)
  if (!m) return null
  const username = m[1]
  const host = m[2]
  const port = m[3] ? parseInt(m[3], 10) : 22
  if (!username || !host || isNaN(port) || port < 1 || port > 65535) return null
  return { username, host, port }
}

export function QuickConnect({ open, onOpenChange, onConnect }: Props): JSX.Element {
  const [target, setTarget] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setTarget('')
      setPassword('')
      setError(null)
    } else {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  function submit(): void {
    const parsed = parseTarget(target)
    if (!parsed) {
      setError('形式: user@host または user@host:port')
      return
    }
    onConnect({ ...parsed, password: password || undefined })
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="クイック接続" width="max-w-md">
      <p className="mb-3 text-xs text-fg-mute">
        セッションは &quot;Quick&quot; フォルダに保存され、後で削除できます。形式は{' '}
        <code className="rounded bg-bg-mute px-1">user@host[:port]</code>。
      </p>
      <Field label="接続先">
        <Input
          ref={inputRef}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="user@example.com:22"
        />
      </Field>
      <Field label="パスワード (任意、空欄なら接続時にプロンプト)">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>
      {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>キャンセル</Button>
        <Button onClick={submit} disabled={!target}>接続</Button>
      </div>
    </Modal>
  )
}
