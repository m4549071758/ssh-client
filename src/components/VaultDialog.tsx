import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Button, Field, Input } from './ui'
import { api, type VaultEntry, type VaultEntryPublic, type VaultStatus } from '../ipc'
import { Fingerprint, Lock, Plus, Trash2, Unlock } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: VaultStatus
  entries: VaultEntryPublic[]
  onChanged: () => void
}

export function VaultDialog({ open, onOpenChange, status, entries, onChanged }: Props) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // entry editor
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [secretType, setSecretType] = useState<VaultEntry['secretType']>('password')
  const [secretValue, setSecretValue] = useState('')

  useEffect(() => {
    if (!open) {
      setPw('')
      setPw2('')
      setError(null)
      setLabel('')
      setUsername('')
      setSecretValue('')
    }
  }, [open])

  async function setupMaster() {
    if (pw !== pw2) return setError('パスワードが一致しません')
    if (pw.length < 6) return setError('6 文字以上にしてください')
    setBusy(true)
    try {
      await api.vault.setupMaster(pw)
      // unlock immediately
      await api.vault.unlockMaster(pw, 15)
      setPw('')
      setPw2('')
      setError(null)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unlock() {
    setBusy(true)
    try {
      await api.vault.unlockMaster(pw, 15)
      setPw('')
      setError(null)
      onChanged()
    } catch (e) {
      setError('解除に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function unlockHello() {
    setBusy(true)
    try {
      await api.vault.unlockHello(15)
      setError(null)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function enrollHello() {
    setBusy(true)
    try {
      await api.vault.enrollHello()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function lock() {
    await api.vault.lock()
    onChanged()
  }

  async function addEntry() {
    if (!label || !secretValue) return
    await api.vault.upsert({ label, username, secretType, value: secretValue } as Omit<VaultEntry, 'id'>)
    setLabel('')
    setUsername('')
    setSecretValue('')
    onChanged()
  }

  async function removeEntry(id: string) {
    await api.vault.delete(id)
    onChanged()
  }

  const title = !status.hasMasterPassword
    ? 'Vault を初期化'
    : !status.isUnlocked
      ? 'Vault を解除'
      : '認証情報 Vault'

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} width="max-w-xl">
      {!status.hasMasterPassword && (
        <>
          <p className="mb-3 text-sm text-fg-mute">
            グローバルな認証情報を保管するためのマスターパスワードを設定します。設定後、Windows Hello でも解除できるようにできます。
          </p>
          <Field label="マスターパスワード">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
          <Field label="再入力">
            <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={setupMaster} disabled={busy}>
              <Lock size={14} /> 設定
            </Button>
          </div>
        </>
      )}

      {status.hasMasterPassword && !status.isUnlocked && (
        <>
          <Field label="マスターパスワード">
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
              autoFocus
            />
          </Field>
          {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            {status.helloEnrolled && status.helloAvailable && (
              <Button variant="ghost" onClick={unlockHello} disabled={busy}>
                <Fingerprint size={14} /> Windows Hello で解除
              </Button>
            )}
            <Button onClick={unlock} disabled={busy}>
              <Unlock size={14} /> 解除
            </Button>
          </div>
        </>
      )}

      {status.isUnlocked && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-fg-mute">{entries.length} 件のエントリ</span>
            <div className="flex gap-2">
              {status.helloAvailable && !status.helloEnrolled && (
                <Button variant="ghost" onClick={enrollHello} disabled={busy}>
                  <Fingerprint size={14} /> Windows Hello を有効化
                </Button>
              )}
              <Button variant="ghost" onClick={lock}>
                <Lock size={14} /> ロック
              </Button>
            </div>
          </div>

          <div className="mb-4 max-h-48 overflow-auto rounded-md border border-border">
            {entries.length === 0 && <p className="p-3 text-xs text-fg-mute">まだエントリがありません</p>}
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0">
                <div className="text-sm">
                  <div>{e.label}</div>
                  <div className="text-xs text-fg-mute">
                    {e.secretType}
                    {e.username ? ` · ${e.username}` : ''}
                  </div>
                </div>
                <button onClick={() => removeEntry(e.id)} className="text-fg-mute hover:text-rose-400">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-xs font-semibold text-fg-mute">新しい認証情報を追加</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ラベル">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: prod password" />
              </Field>
              <Field label="ユーザー名 (任意)">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
            </div>
            <Field label="種類">
              <select
                className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                value={secretType}
                onChange={(e) => setSecretType(e.target.value as any)}
              >
                <option value="password">パスワード</option>
                <option value="passphrase">秘密鍵パスフレーズ</option>
              </select>
            </Field>
            <Field label="値">
              <Input type="password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button onClick={addEntry} disabled={!label || !secretValue}>
                <Plus size={14} /> 追加
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
