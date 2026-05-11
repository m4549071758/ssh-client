import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Button, Field, Input } from './ui'
import { Download, Upload } from 'lucide-react'
import { api, type VaultStatus } from '../ipc'
import type { BackupSummary } from '../../electron/preload'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vaultStatus: VaultStatus | null
  onChanged: () => void
}

export function BackupDialog({ open, onOpenChange, vaultStatus, onChanged }: Props): JSX.Element {
  const [mode, setMode] = useState<'export' | 'import'>('export')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ summary: BackupSummary; kind: 'export' | 'import' } | null>(null)

  useEffect(() => {
    if (!open) {
      setPassword('')
      setPassword2('')
      setError(null)
      setResult(null)
      setMode('export')
    }
  }, [open])

  async function doExport(): Promise<void> {
    setError(null)
    if (!vaultStatus?.isUnlocked) {
      setError('エクスポートには Vault の解錠が必要です')
      return
    }
    if (password.length < 8) {
      setError('パスワードは 8 文字以上にしてください')
      return
    }
    if (password !== password2) {
      setError('パスワードが一致しません')
      return
    }
    setBusy(true)
    try {
      const summary = await api.backup.exportBackup(password)
      if (summary) setResult({ summary, kind: 'export' })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doImport(): Promise<void> {
    setError(null)
    if (!password) {
      setError('パスワードを入力してください')
      return
    }
    if (!confirm('インポートすると既存のセッション・既知ホスト・設定がすべて上書きされます。続行しますか?')) {
      return
    }
    setBusy(true)
    try {
      const summary = await api.backup.importBackup(password)
      if (summary) {
        setResult({ summary, kind: 'import' })
        onChanged()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="バックアップ" width="max-w-lg">
      {!result && (
        <>
          <div className="mb-4 flex gap-1 border-b border-border">
            <button
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors ${mode === 'export' ? 'border-b-2 border-accent text-accent' : 'text-fg-mute hover:text-fg'}`}
              onClick={() => setMode('export')}
            >
              <Download size={14} /> エクスポート
            </button>
            <button
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors ${mode === 'import' ? 'border-b-2 border-accent text-accent' : 'text-fg-mute hover:text-fg'}`}
              onClick={() => setMode('import')}
            >
              <Upload size={14} /> インポート
            </button>
          </div>

          {mode === 'export' ? (
            <>
              <p className="mb-3 text-xs text-fg-mute">
                セッション一覧、Vault エントリ、既知ホスト鍵、設定をまとめて暗号化ファイルに出力します。
                Vault エントリを含むためにはあらかじめ Vault を解錠してください。
              </p>
              {!vaultStatus?.isUnlocked && (
                <p className="mb-3 rounded bg-rose-900/30 px-2 py-1 text-xs text-rose-300">
                  Vault がロック中です。解錠せずに進めると Vault エントリは含まれません。
                </p>
              )}
              <Field label="バックアップ用パスワード (8 文字以上)">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="パスワード (確認)">
                <Input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
              </Field>
              {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>キャンセル</Button>
                <Button onClick={doExport} disabled={busy || !password}>
                  {busy ? '保存中…' : 'エクスポート'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-fg-mute">
                バックアップファイルを選択し、エクスポート時のパスワードを入力してください。
                <strong className="text-rose-400">既存のセッション・既知ホスト・設定はすべて上書きされます。</strong>
              </p>
              {!vaultStatus?.isUnlocked && (
                <p className="mb-3 rounded bg-amber-900/30 px-2 py-1 text-xs text-amber-300">
                  Vault がロック中です。Vault エントリの復元はスキップされます (解錠後にインポートしてください)。
                </p>
              )}
              <Field label="バックアップ用パスワード">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>キャンセル</Button>
                <Button onClick={doImport} disabled={busy || !password}>
                  {busy ? 'インポート中…' : 'ファイルを選択してインポート'}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {result && (
        <>
          <p className="mb-3 text-sm text-emerald-400">
            ✓ {result.kind === 'export' ? 'バックアップを書き出しました' : 'バックアップを復元しました'}
          </p>
          <div className="space-y-1 text-sm">
            <p>Vault エントリ: {result.summary.vaultEntries} 件</p>
            <p>セッション: {result.summary.sessions} 件</p>
            <p>既知ホスト鍵: {result.summary.knownHosts} 件</p>
            <p className="text-fg-mute">出力日時: {new Date(result.summary.exportedAt).toLocaleString()}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => onOpenChange(false)}>閉じる</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
