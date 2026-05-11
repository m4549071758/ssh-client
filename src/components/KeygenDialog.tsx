import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Button, Field, Input } from './ui'
import { api } from '../ipc'

type Algorithm = 'ed25519' | 'rsa' | 'ecdsa'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeygenDialog({ open, onOpenChange }: Props): JSX.Element {
  const [algorithm, setAlgorithm] = useState<Algorithm>('ed25519')
  const [bits, setBits] = useState(4096)
  const [comment, setComment] = useState('')
  const [filename, setFilename] = useState('id_ed25519')
  const [saveDir, setSaveDir] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [passphrase2, setPassphrase2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ privateKeyPath: string; publicKeyPath: string; fingerprint: string; publicKey: string } | null>(null)

  useEffect(() => {
    if (!open) return
    api.keys.defaultDir().then((dir) => setSaveDir(dir)).catch(() => setSaveDir(''))
    setResult(null)
    setError(null)
    setPassphrase('')
    setPassphrase2('')
  }, [open])

  useEffect(() => {
    setFilename(
      algorithm === 'ed25519'
        ? 'id_ed25519'
        : algorithm === 'rsa'
          ? 'id_rsa'
          : 'id_ecdsa'
    )
    if (algorithm === 'rsa') setBits(4096)
    if (algorithm === 'ecdsa') setBits(256)
  }, [algorithm])

  async function pickDir(): Promise<void> {
    const dir = await api.keys.pickSaveDir()
    if (dir) setSaveDir(dir)
  }

  async function generate(): Promise<void> {
    setError(null)
    if (passphrase !== passphrase2) {
      setError('パスフレーズが一致しません')
      return
    }
    if (!saveDir || !filename) {
      setError('保存先と名前を指定してください')
      return
    }
    setBusy(true)
    try {
      // saveDir + '/' + filename
      const sep = saveDir.endsWith('/') || saveDir.endsWith('\\') ? '' : '/'
      const privateKeyPath = `${saveDir}${sep}${filename}`
      const res = await api.keys.generate({
        algorithm,
        bits: algorithm === 'ed25519' ? undefined : bits,
        comment: comment || undefined,
        passphrase: passphrase || undefined,
        privateKeyPath
      })
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="SSH 鍵ペア生成" width="max-w-lg">
      {!result && (
        <>
          <Field label="アルゴリズム">
            <select
              className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
            >
              <option value="ed25519">Ed25519 (推奨、高速・短い鍵)</option>
              <option value="rsa">RSA</option>
              <option value="ecdsa">ECDSA</option>
            </select>
          </Field>

          {algorithm === 'rsa' && (
            <Field label="鍵長">
              <select
                className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                value={bits}
                onChange={(e) => setBits(parseInt(e.target.value, 10))}
              >
                <option value={2048}>2048 ビット</option>
                <option value={3072}>3072 ビット</option>
                <option value={4096}>4096 ビット (推奨)</option>
              </select>
            </Field>
          )}

          {algorithm === 'ecdsa' && (
            <Field label="曲線">
              <select
                className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                value={bits}
                onChange={(e) => setBits(parseInt(e.target.value, 10))}
              >
                <option value={256}>P-256</option>
                <option value={384}>P-384</option>
                <option value={521}>P-521</option>
              </select>
            </Field>
          )}

          <Field label="コメント (任意)">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="例: user@host" />
          </Field>

          <Field label="保存先">
            <div className="flex gap-2">
              <Input value={saveDir} onChange={(e) => setSaveDir(e.target.value)} />
              <Button variant="ghost" onClick={pickDir} type="button">参照…</Button>
            </div>
          </Field>

          <Field label="ファイル名">
            <Input value={filename} onChange={(e) => setFilename(e.target.value)} />
            <p className="mt-1 text-xs text-fg-mute">公開鍵は同じ場所に <code>{filename}.pub</code> で保存されます</p>
          </Field>

          <Field label="パスフレーズ (任意)">
            <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </Field>
          {passphrase && (
            <Field label="パスフレーズ (確認)">
              <Input type="password" value={passphrase2} onChange={(e) => setPassphrase2(e.target.value)} />
            </Field>
          )}

          {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>キャンセル</Button>
            <Button onClick={generate} disabled={busy || !saveDir || !filename}>
              {busy ? '生成中…' : '生成'}
            </Button>
          </div>
        </>
      )}

      {result && (
        <>
          <p className="mb-3 text-sm text-emerald-400">✓ 鍵ペアを生成しました</p>
          <div className="space-y-2 text-xs">
            <div>
              <p className="text-fg-mute">秘密鍵:</p>
              <code className="block break-all rounded bg-bg-mute px-2 py-1 font-mono">{result.privateKeyPath}</code>
            </div>
            <div>
              <p className="text-fg-mute">公開鍵:</p>
              <code className="block break-all rounded bg-bg-mute px-2 py-1 font-mono">{result.publicKeyPath}</code>
            </div>
            <div>
              <p className="text-fg-mute">フィンガープリント:</p>
              <code className="block break-all rounded bg-bg-mute px-2 py-1 font-mono">{result.fingerprint}</code>
            </div>
            <div>
              <p className="text-fg-mute">公開鍵 (authorized_keys に追加するもの):</p>
              <textarea
                readOnly
                value={result.publicKey}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                className="h-20 w-full resize-none rounded bg-bg-mute px-2 py-1 font-mono text-[11px] outline-none"
              />
              <Button
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(result.publicKey).catch(() => undefined)}
                className="mt-1"
              >
                公開鍵をコピー
              </Button>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => onOpenChange(false)}>閉じる</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
