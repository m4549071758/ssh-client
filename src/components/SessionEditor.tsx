import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Button, Field, Input } from './ui'
import { api, type SessionProfile, type VaultEntryPublic } from '../ipc'

interface Props {
  open: boolean
  initial?: SessionProfile | null
  vaultUnlocked: boolean
  vaultEntries: VaultEntryPublic[]
  onClose: () => void
  onSaved: (s: SessionProfile) => void
}

export function SessionEditor({ open, initial, vaultUnlocked, vaultEntries, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(22)
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<SessionProfile['authType']>('password')
  const [credentialId, setCredentialId] = useState<string>('')
  const [privateKeyPath, setPrivateKeyPath] = useState<string>('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setHost(initial?.host ?? '')
    setPort(initial?.port ?? 22)
    setUsername(initial?.username ?? '')
    setAuthType(initial?.authType ?? 'password')
    setCredentialId(initial?.credentialId ?? '')
    setPrivateKeyPath(initial?.privateKeyPath ?? '')
  }, [open, initial])

  async function pickKey() {
    const p = await api.dialog.openPrivateKey()
    if (p) setPrivateKeyPath(p)
  }

  async function save() {
    const saved = await api.sessions.save({
      id: initial?.id,
      name: name || `${username}@${host}`,
      host,
      port: Number(port) || 22,
      username,
      authType,
      credentialId: credentialId || undefined,
      privateKeyPath: privateKeyPath || undefined
    })
    onSaved(saved)
    onClose()
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={initial ? 'セッションを編集' : '新規セッション'}>
      <Field label="名前">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: prod-web-01" />
      </Field>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Field label="ホスト">
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" />
        </Field>
        <Field label="ポート">
          <Input type="number" value={port} onChange={(e) => setPort(parseInt(e.target.value || '22', 10))} />
        </Field>
      </div>
      <Field label="ユーザー名">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="認証方式">
        <select
          className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
          value={authType}
          onChange={(e) => setAuthType(e.target.value as any)}
        >
          <option value="password">パスワード認証</option>
          <option value="privateKey">公開鍵認証 (秘密鍵ファイル)</option>
          <option value="credentialRef">Vault 参照 (グローバル認証情報)</option>
        </select>
      </Field>
      {authType === 'privateKey' && (
        <Field label="秘密鍵ファイル">
          <div className="flex gap-2">
            <Input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} placeholder="C:\Users\me\.ssh\id_ed25519" />
            <Button variant="ghost" onClick={pickKey} type="button">
              参照…
            </Button>
          </div>
        </Field>
      )}
      <Field label={authType === 'privateKey' ? 'パスフレーズの Vault エントリ (任意)' : 'Vault エントリ (任意)'}>
        {!vaultUnlocked && (
          <p className="text-xs text-fg-mute">Vault がロックされています。Vault を解除すると一覧が表示されます。</p>
        )}
        {vaultUnlocked && (
          <select
            className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
            value={credentialId}
            onChange={(e) => {
              const id = e.target.value
              setCredentialId(id)
              if (id && !username) {
                const entry = vaultEntries.find((v) => v.id === id)
                if (entry?.username) setUsername(entry.username)
              }
            }}
          >
            <option value="">— 使用しない —</option>
            {vaultEntries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} ({e.secretType}{e.username ? ` · ${e.username}` : ''})
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button onClick={save} disabled={!host || !username}>
          保存
        </Button>
      </div>
    </Modal>
  )
}
