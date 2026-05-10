import Editor, { type OnMount } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Button } from './ui'
import { Save } from 'lucide-react'
import type * as monacoNS from 'monaco-editor'

const langByExt: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', cs: 'csharp',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', md: 'markdown', json: 'json',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sh: 'shell', bash: 'shell',
  zsh: 'shell', fish: 'shell', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', xml: 'xml', php: 'php', kt: 'kotlin', swift: 'swift', lua: 'lua',
  vim: 'vim', dockerfile: 'dockerfile', tf: 'hcl'
}

function detectLanguage(path: string): string {
  const base = path.split('/').pop() || ''
  if (/^Dockerfile$/i.test(base)) return 'dockerfile'
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return langByExt[ext] || 'plaintext'
}

export function EditorModal({
  open,
  path,
  initialContents,
  theme,
  onSave,
  onClose
}: {
  open: boolean
  path: string
  initialContents: string
  theme?: 'vs' | 'vs-dark'
  onSave: (contents: string) => Promise<void> | void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialContents)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const valueRef = useRef(value)
  useEffect(() => {
    setValue(initialContents)
    valueRef.current = initialContents
  }, [initialContents])

  const language = detectLanguage(path)
  const monacoTheme = theme ?? 'vs-dark'

  async function handleSave(contents: string) {
    if (saving) return
    setSaving(true)
    setSaveStatus(null)
    try {
      await onSave(contents)
      setSaveStatus('保存しました')
      setTimeout(() => setSaveStatus(null), 1500)
    } catch (e) {
      setSaveStatus(`エラー: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        const v = valueRef.current
        handleSave(v)
      }
    )
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={path} width="max-w-5xl">
      <div className="h-[60vh] rounded-md border border-border">
        <Editor
          height="100%"
          theme={monacoTheme}
          language={language}
          value={value}
          onChange={(v) => {
            const newVal = v ?? ''
            setValue(newVal)
            valueRef.current = newVal
          }}
          onMount={handleEditorMount}
          options={{
            fontFamily: "'Cascadia Code', 'Yu Gothic Mono', 'MS Gothic', monospace",
            fontSize: 13,
            minimap: { enabled: false },
            wordWrap: 'on',
            renderWhitespace: 'selection'
          }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-fg-mute">
          {saving && <span className="animate-pulse">保存中…</span>}
          {!saving && saveStatus && <span className="text-green-400">{saveStatus}</span>}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>キャンセル</Button>
          <Button onClick={() => handleSave(value)} disabled={saving}>
            <Save size={14} /> 保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}
