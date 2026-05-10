import { useState } from 'react'
import { Modal } from './Modal'
import { Button, Field, Input } from './ui'

export function AuthPrompt({
  open,
  title,
  label,
  onSubmit,
  onCancel
}: {
  open: boolean
  title: string
  label: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState('')
  return (
    <Modal open={open} onOpenChange={(o) => !o && onCancel()} title={title}>
      <Field label={label}>
        <Input
          type="password"
          value={v}
          onChange={(e) => setV(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSubmit(v)
              setV('')
            }
          }}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button
          onClick={() => {
            onSubmit(v)
            setV('')
          }}
        >
          OK
        </Button>
      </div>
    </Modal>
  )
}
