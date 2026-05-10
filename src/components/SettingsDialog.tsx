import { Modal } from './Modal'
import { Button, Field, Input } from './ui'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../ipc'

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

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="設定">
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
    </Modal>
  )
}
