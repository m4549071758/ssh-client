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
  const [group, setGroup] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  // A5: セッション単位の接続設定
  const [useGlobalKeepalive, setUseGlobalKeepalive] = useState(true)
  const [keepaliveInterval, setKeepaliveInterval] = useState(30)
  const [keepaliveCountMax, setKeepaliveCountMax] = useState(3)
  const [useGlobalReconnect, setUseGlobalReconnect] = useState(true)
  const [autoReconnect, setAutoReconnect] = useState(true)
  const [autoReconnectMaxRetries, setAutoReconnectMaxRetries] = useState(5)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setHost(initial?.host ?? '')
    setPort(initial?.port ?? 22)
    setUsername(initial?.username ?? '')
    setAuthType(initial?.authType ?? 'password')
    setCredentialId(initial?.credentialId ?? '')
    setPrivateKeyPath(initial?.privateKeyPath ?? '')
    setGroup(initial?.group ?? '')
    setTags(initial?.tags ?? [])
    setTagInput('')
    setUseGlobalKeepalive(initial?.keepaliveInterval === undefined)
    setKeepaliveInterval(initial?.keepaliveInterval !== undefined ? Math.round(initial.keepaliveInterval / 1000) : 30)
    setKeepaliveCountMax(initial?.keepaliveCountMax ?? 3)
    setUseGlobalReconnect(initial?.autoReconnect === undefined)
    setAutoReconnect(initial?.autoReconnect ?? true)
    setAutoReconnectMaxRetries(initial?.autoReconnectMaxRetries ?? 5)
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
      privateKeyPath: privateKeyPath || undefined,
      group: group.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      keepaliveInterval: useGlobalKeepalive ? undefined : keepaliveInterval * 1000,
      keepaliveCountMax: useGlobalKeepalive ? undefined : keepaliveCountMax,
      autoReconnect: useGlobalReconnect ? undefined : autoReconnect,
      autoReconnectMaxRetries: useGlobalReconnect ? undefined : autoReconnectMaxRetries
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
      {/* D1: 分類 */}
      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-3 text-sm font-medium text-fg">分類</p>
        <Field label="フォルダ (任意)">
          <Input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder='例: Production/AWS ("/" 区切りで階層化)'
          />
        </Field>
        <Field label="タグ (任意)">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg-soft px-2 py-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded bg-bg-mute px-1.5 py-0.5 text-xs text-fg"
              >
                {t}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  className="text-fg-mute hover:text-rose-400"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  const v = tagInput.trim().replace(/,$/, '')
                  if (v && !tags.includes(v)) setTags([...tags, v])
                  setTagInput('')
                } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                  setTags(tags.slice(0, -1))
                }
              }}
              placeholder={tags.length === 0 ? 'Enter or カンマで追加' : ''}
              className="min-w-[80px] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-mute"
            />
          </div>
        </Field>
      </div>

      {/* A5: 詳細設定 */}
      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-3 text-sm font-medium text-fg">詳細設定 (接続)</p>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useGlobalKeepalive}
            onChange={(e) => setUseGlobalKeepalive(e.target.checked)}
          />
          Keep-Alive はグローバル設定を使用する
        </label>
        {!useGlobalKeepalive && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Keep-Alive 間隔 (秒, 0=無効)">
              <Input
                type="number"
                value={keepaliveInterval}
                onChange={(e) => setKeepaliveInterval(parseInt(e.target.value || '30', 10))}
              />
            </Field>
            <Field label="Keep-Alive 許容失敗回数">
              <Input
                type="number"
                value={keepaliveCountMax}
                onChange={(e) => setKeepaliveCountMax(parseInt(e.target.value || '3', 10))}
              />
            </Field>
          </div>
        )}
        <label className="mt-2 mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useGlobalReconnect}
            onChange={(e) => setUseGlobalReconnect(e.target.checked)}
          />
          自動再接続はグローバル設定を使用する
        </label>
        {!useGlobalReconnect && (
          <>
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoReconnect}
                onChange={(e) => setAutoReconnect(e.target.checked)}
              />
              切断時に自動で再接続する
            </label>
            <Field label="最大再試行回数">
              <Input
                type="number"
                value={autoReconnectMaxRetries}
                onChange={(e) => setAutoReconnectMaxRetries(parseInt(e.target.value || '5', 10))}
                disabled={!autoReconnect}
              />
            </Field>
          </>
        )}
      </div>

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
