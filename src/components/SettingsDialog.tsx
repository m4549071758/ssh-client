import { Modal } from './Modal'
import { Button, Field, Input } from './ui'
import { useEffect, useState } from 'react'
import type { AppSettings, KnownHostEntry } from '../ipc'
import { api } from '../ipc'

const presetFonts = [
  "'Cascadia Code', 'Yu Gothic Mono', 'MS Gothic', monospace",
  "'JetBrains Mono', 'Yu Gothic Mono', 'MS Gothic', monospace",
  "'Fira Code', 'Yu Gothic Mono', 'MS Gothic', monospace",
  "'Consolas', 'Yu Gothic Mono', 'MS Gothic', monospace",
  "'Source Code Pro', 'Yu Gothic Mono', 'MS Gothic', monospace",
  "'BIZ UDGothic', monospace"
]

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  settings: AppSettings
  onSave: (patch: Partial<AppSettings>) => void
}) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings, open])

  const [activeTab, setActiveTab] = useState<'general' | 'snippets' | 'hostkeys'>('general')
  const [knownHosts, setKnownHosts] = useState<KnownHostEntry[]>([])

  useEffect(() => {
    if (open && activeTab === 'hostkeys') {
      api.knownHosts.list().then(setKnownHosts).catch(() => undefined)
    }
  }, [open, activeTab])

  async function handleRemoveHost(host: string) {
    await api.knownHosts.remove(host)
    setKnownHosts((prev) => prev.filter((e) => e.host !== host))
  }

  async function handleClearHosts() {
    await api.knownHosts.clear()
    setKnownHosts([])
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="設定" width="max-w-2xl">
      {/* タブ */}
      <div className="mb-4 flex gap-1 border-b border-border">
        <button
          className={`px-3 py-1.5 text-sm transition-colors ${activeTab === 'general' ? 'border-b-2 border-accent text-accent' : 'text-fg-mute hover:text-fg'}`}
          onClick={() => setActiveTab('general')}
        >
          一般
        </button>
        <button
          className={`px-3 py-1.5 text-sm transition-colors ${activeTab === 'snippets' ? 'border-b-2 border-accent text-accent' : 'text-fg-mute hover:text-fg'}`}
          onClick={() => setActiveTab('snippets')}
        >
          スニペット
        </button>
        <button
          className={`px-3 py-1.5 text-sm transition-colors ${activeTab === 'hostkeys' ? 'border-b-2 border-accent text-accent' : 'text-fg-mute hover:text-fg'}`}
          onClick={() => setActiveTab('hostkeys')}
        >
          ホスト鍵
        </button>
      </div>

      {activeTab === 'snippets' && (
        <SnippetsEditor
          snippets={draft.snippets ?? []}
          onChange={(snippets) => setDraft({ ...draft, snippets })}
        />
      )}
      {activeTab === 'snippets' && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button
            onClick={() => {
              onSave(draft)
              onOpenChange(false)
            }}
          >
            保存
          </Button>
        </div>
      )}

      {activeTab === 'hostkeys' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-fg-mute">既知のホスト鍵一覧 ({knownHosts.length} 件)</p>
            <Button variant="danger" onClick={handleClearHosts} disabled={knownHosts.length === 0}>
              全削除
            </Button>
          </div>
          {knownHosts.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-mute">登録されたホスト鍵はありません</p>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {knownHosts.map((entry) => (
                <div key={entry.host} className="rounded border border-border bg-bg-mute p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium text-fg">{entry.host}</p>
                      <code className="mt-0.5 block break-all text-xs text-fg-mute">{entry.fingerprint}</code>
                      <p className="mt-1 text-xs text-fg-mute">
                        初回: {new Date(entry.firstSeen).toLocaleString()} / 最終: {new Date(entry.lastSeen).toLocaleString()}
                      </p>
                    </div>
                    <Button variant="danger" onClick={() => handleRemoveHost(entry.host)}>
                      削除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>閉じる</Button>
          </div>
        </div>
      )}

      {activeTab === 'general' && <>
      <Field label="フォントファミリ">
        <select
          className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
          value={presetFonts.includes(draft.fontFamily) ? draft.fontFamily : '__custom'}
          onChange={(e) => {
            if (e.target.value === '__custom') return
            setDraft({ ...draft, fontFamily: e.target.value })
          }}
        >
          {presetFonts.map((f) => (
            <option key={f} value={f}>
              {f.split(',')[0].replace(/'/g, '')}
            </option>
          ))}
          <option value="__custom">カスタム…</option>
        </select>
        <Input
          className="mt-2"
          value={draft.fontFamily}
          onChange={(e) => setDraft({ ...draft, fontFamily: e.target.value })}
        />
        <p className="mt-1 text-xs text-fg-mute">
          CJK 表示崩れを避けるため、`'Yu Gothic Mono', 'MS Gothic'` を後段に含めることを推奨します。
        </p>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="フォントサイズ">
          <Input
            type="number"
            value={draft.fontSize}
            onChange={(e) => setDraft({ ...draft, fontSize: parseInt(e.target.value || '14', 10) })}
          />
        </Field>
        <Field label="行間">
          <Input
            type="number"
            step="0.05"
            value={draft.lineHeight}
            onChange={(e) => setDraft({ ...draft, lineHeight: parseFloat(e.target.value || '1.2') })}
          />
        </Field>
      </div>

      <Field label="テーマ">
        <select
          className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
          value={draft.theme}
          onChange={(e) => setDraft({ ...draft, theme: e.target.value as AppSettings['theme'] })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="solarized-dark">Solarized Dark</option>
        </select>
      </Field>

      <Field label="動作">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.copyOnSelect}
            onChange={(e) => setDraft({ ...draft, copyOnSelect: e.target.checked })}
          />
          選択範囲を自動でコピーする
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.bracketedPaste}
            onChange={(e) => setDraft({ ...draft, bracketedPaste: e.target.checked })}
          />
          bracketed paste を有効にする
        </label>
      </Field>

      <Field label="Vault 自動ロック (分, 0 で無効)">
        <Input
          type="number"
          value={draft.autoLockMinutes}
          onChange={(e) => setDraft({ ...draft, autoLockMinutes: parseInt(e.target.value || '15', 10) })}
        />
      </Field>

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-3 text-sm font-medium text-fg">接続</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Keep-Alive 間隔 (秒, 0=無効)">
            <Input
              type="number"
              value={Math.round(draft.keepaliveInterval / 1000)}
              onChange={(e) => setDraft({ ...draft, keepaliveInterval: (parseInt(e.target.value || '30', 10)) * 1000 })}
            />
          </Field>
          <Field label="Keep-Alive 許容失敗回数">
            <Input
              type="number"
              value={draft.keepaliveCountMax}
              onChange={(e) => setDraft({ ...draft, keepaliveCountMax: parseInt(e.target.value || '3', 10) })}
            />
          </Field>
        </div>
        <Field label="自動再接続">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.autoReconnect}
              onChange={(e) => setDraft({ ...draft, autoReconnect: e.target.checked })}
            />
            切断時に自動で再接続する
          </label>
        </Field>
        <Field label="最大再試行回数">
          <Input
            type="number"
            value={draft.autoReconnectMaxRetries}
            onChange={(e) => setDraft({ ...draft, autoReconnectMaxRetries: parseInt(e.target.value || '5', 10) })}
            disabled={!draft.autoReconnect}
          />
        </Field>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-3 text-sm font-medium text-fg">転送</p>
        <Field label="並列転送数 (1〜10)">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={10}
              value={draft.transferConcurrency ?? 4}
              onChange={(e) => setDraft({ ...draft, transferConcurrency: parseInt(e.target.value, 10) })}
              className="flex-1"
            />
            <Input
              type="number"
              className="w-16"
              value={draft.transferConcurrency ?? 4}
              onChange={(e) => {
                const v = parseInt(e.target.value || '4', 10)
                setDraft({ ...draft, transferConcurrency: Math.max(1, Math.min(10, v)) })
              }}
            />
          </div>
          <p className="mt-1 text-xs text-fg-mute">同時にアップロード / ダウンロードするファイル数。</p>
        </Field>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>キャンセル</Button>
        <Button
          onClick={() => {
            onSave(draft)
            onOpenChange(false)
          }}
        >
          保存
        </Button>
      </div>
      </>}
    </Modal>
  )
}

function SnippetsEditor({
  snippets,
  onChange
}: {
  snippets: AppSettings['snippets']
  onChange: (next: AppSettings['snippets']) => void
}): JSX.Element {
  function add(): void {
    const id = 'sn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    onChange([...snippets, { id, label: '新規スニペット', content: '', appendNewline: true }])
  }
  function update(id: string, patch: Partial<AppSettings['snippets'][number]>): void {
    onChange(snippets.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }
  function remove(id: string): void {
    onChange(snippets.filter((s) => s.id !== id))
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-fg-mute">登録済みスニペット ({snippets.length} 件)</p>
        <Button variant="ghost" onClick={add}>追加</Button>
      </div>
      {snippets.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-mute">スニペットが登録されていません</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {snippets.map((s) => (
            <div key={s.id} className="rounded border border-border bg-bg-mute p-2">
              <div className="mb-2 flex items-center gap-2">
                <Input
                  value={s.label}
                  onChange={(e) => update(s.id, { label: e.target.value })}
                  placeholder="ラベル"
                />
                <Button variant="danger" onClick={() => remove(s.id)}>削除</Button>
              </div>
              <textarea
                value={s.content}
                onChange={(e) => update(s.id, { content: e.target.value })}
                placeholder="送信するコマンド (複数行可)"
                rows={3}
                className="w-full resize-y rounded-md border border-border bg-bg-soft px-2.5 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-fg-mute">
                <input
                  type="checkbox"
                  checked={s.appendNewline}
                  onChange={(e) => update(s.id, { appendNewline: e.target.checked })}
                />
                送信時に末尾改行を付与する
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
