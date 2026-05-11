import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Download, ExternalLink, Eye, EyeOff, FileText, Folder, FolderPlus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api, type SftpEntry, type AppSettings } from '../ipc'
import { Button, Input, cn } from './ui'
import { EditorModal } from './EditorModal'
import { Modal } from './Modal'
import { TransferStatusBar } from './TransferStatusBar'

export function SftpPane({ handle, theme }: { handle: string; theme?: 'vs' | 'vs-dark' }) {
  const [path, setPath] = useState<string>('.')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    try { return localStorage.getItem('ssh-client:sftp:showHidden') === '1' } catch { return false }
  })

  const visibleEntries = useMemo(
    () => (showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))),
    [entries, showHidden]
  )

  function toggleHidden(): void {
    const next = !showHidden
    setShowHidden(next)
    try { localStorage.setItem('ssh-client:sftp:showHidden', next ? '1' : '0') } catch { /* ignore */ }
  }
  const [editing, setEditing] = useState<{ path: string; contents: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Multi-select state
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const lastClickedName = useRef<string | null>(null)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // Per-file conflict dialog state
  type FileAction = 'overwrite' | 'skip'
  const [conflictDialog, setConflictDialog] = useState<{
    conflicts: string[]
    uploads: { local: string; remote: string; isDir: boolean }[]
    perFileActions: Record<string, FileAction>
    resolve: (result: { action: 'execute' | 'cancel'; perFileActions: Record<string, FileAction> }) => void
  } | null>(null)

  // Properties modal
  const [propsEntry, setPropsEntry] = useState<{ entry: SftpEntry; fullPath: string } | null>(null)

  // Move/Copy modal
  const [moveModal, setMoveModal] = useState<{ sources: string[]; mode: 'move' | 'copy' } | null>(null)
  const [moveDestInput, setMoveDestInput] = useState('')

  // Rename modal
  const [renameModal, setRenameModal] = useState<{ entry: SftpEntry } | null>(null)
  const [renameInput, setRenameInput] = useState('')

  // TransferStatusBar への登録関数 (ref で保持)
  const registerTransferRef = useRef<((transferId: string, kind: 'upload' | 'download') => void) | null>(null)
  const handleRegister = useCallback(
    (register: (transferId: string, kind: 'upload' | 'download') => void) => {
      registerTransferRef.current = register
    },
    []
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.sftp.list(handle, path)
      setPath(res.path)
      setEntries(res.entries)
      setSelectedNames(new Set())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [handle, path])

  useEffect(() => {
    refresh()
  }, [refresh])

  // M-6: refreshRef を使い onPutBack リスナー登録を handle のみに依存させる
  // (path が変わるたびに remove → re-add されてイベントを取り逃がす問題を防ぐ)
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    const off = api.sftp.onPutBack((info) => {
      if (info.ok) {
        setError(null)
        refreshRef.current()
      } else {
        setError(`保存反映失敗 (${info.remotePath}): ${info.error ?? 'unknown error'}`)
      }
    })
    return () => { off() }
  }, [handle])

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [ctxMenu])

  function joinPath(parent: string, name: string): string {
    if (parent === '/') return '/' + name
    return parent.replace(/\/$/, '') + '/' + name
  }

  async function open(entry: SftpEntry) {
    if (entry.type === 'dir') {
      setPath(joinPath(path, entry.name))
    } else if (entry.type === 'file') {
      try {
        await api.sftp.openExternal(handle, joinPath(path, entry.name))
      } catch (e) {
        setError((e as Error).message)
      }
    }
  }

  async function editInline(entry: SftpEntry) {
    if (entry.type !== 'file') return
    try {
      const contents = await api.sftp.readFile(handle, joinPath(path, entry.name))
      setEditing({ path: joinPath(path, entry.name), contents })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // m-2: 末尾スラッシュや root '/' での誤動作を修正
  function up() {
    const cleaned = path.replace(/\/+$/, '') || '/'
    if (cleaned === '/') return
    const idx = cleaned.lastIndexOf('/')
    const parent = idx <= 0 ? '/' : cleaned.slice(0, idx)
    setPath(parent)
  }

  async function uploadAndExecute(localPaths: string[]) {
    if (localPaths.length === 0) return
    const items = localPaths.map((localPath) => ({ localPath, remoteDir: path }))
    const plan = await api.sftp.planUpload(handle, items)

    let uploadsToRun = plan.uploads
    if (plan.conflicts.length > 0) {
      const result = await askConflict(plan.conflicts, plan.uploads)
      if (result.action === 'cancel') return
      // per-file の skip を反映して uploads を絞り込む
      uploadsToRun = plan.uploads.filter((u) => {
        if (!plan.conflicts.includes(u.remote)) return true
        return (result.perFileActions[u.remote] ?? 'overwrite') === 'overwrite'
      })
    }

    if (uploadsToRun.length === 0) return

    // ディレクトリ作成は先に順次実行、ファイルのみ並列転送
    const dirs = uploadsToRun.filter((u) => u.isDir)
    const files = uploadsToRun.filter((u) => !u.isDir)

    // dirs を順次 mkdir (既存エラーは無視する sftp:executeUpload を利用)
    if (dirs.length > 0) {
      await api.sftp.executeUpload(handle, dirs, 'overwrite')
    }

    if (files.length > 0) {
      const transferId = await api.transfer.startUpload(handle, files)
      registerTransferRef.current?.(transferId, 'upload')
      // 完了後にリスト更新
      const offComplete = api.transfer.onComplete(transferId, () => {
        offComplete()
        refresh().catch(() => undefined)
      })
    }
  }

  async function upload() {
    try {
      const picked = await api.dialog.openFiles()
      if (picked.length === 0) return
      await uploadAndExecute(picked)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function download(entry: SftpEntry) {
    if (entry.type !== 'file') return
    try {
      await api.sftp.download(handle, joinPath(path, entry.name), entry.name)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function removeSingle(entry: SftpEntry) {
    const isDir = entry.type === 'dir'
    const msg = isDir
      ? `「${entry.name}」フォルダを削除しますか?\n中のファイルもすべて削除されます。`
      : `「${entry.name}」を削除しますか?`
    if (!confirm(msg)) return
    try {
      await api.sftp.remove(handle, joinPath(path, entry.name), isDir)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function makeDir() {
    const name = prompt('新規フォルダ名')
    if (!name) return
    try {
      await api.sftp.mkdir(handle, joinPath(path, name))
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function saveEditor(contents: string) {
    if (!editing) return
    await api.sftp.writeFile(handle, editing.path, contents)
    setEditing(null)
    await refresh()
  }

  async function openExternal(entry: SftpEntry) {
    if (entry.type !== 'file') return
    try {
      await api.sftp.openExternal(handle, joinPath(path, entry.name))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function askConflict(
    conflicts: string[],
    uploads: { local: string; remote: string; isDir: boolean }[]
  ): Promise<{ action: 'execute' | 'cancel'; perFileActions: Record<string, FileAction> }> {
    return new Promise((resolve) => {
      const initial: Record<string, FileAction> = {}
      for (const c of conflicts) initial[c] = 'overwrite'
      setConflictDialog({ conflicts, uploads, perFileActions: initial, resolve })
    })
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const localPaths: string[] = []
    for (const f of Array.from(e.dataTransfer.files)) {
      let p = (f as any).path as string | undefined
      if (!p) {
        try { p = (window as any).api?.fs?.pathForFile?.(f) } catch { /* ignore */ }
      }
      if (p) localPaths.push(p)
    }
    if (localPaths.length === 0) {
      setError('ドロップされたパスが取得できませんでした')
      return
    }
    try {
      await uploadAndExecute(localPaths)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ── Multi-select helpers ──────────────────────────────────────────────────

  function handleRowClick(e: React.MouseEvent, entry: SftpEntry) {
    const name = entry.name
    if (e.shiftKey && lastClickedName.current) {
      // range select
      const names = entries.map((en) => en.name)
      const from = names.indexOf(lastClickedName.current)
      const to = names.indexOf(name)
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from]
        setSelectedNames(new Set(names.slice(lo, hi + 1)))
      }
    } else if (e.ctrlKey || e.metaKey) {
      // toggle
      setSelectedNames((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
      lastClickedName.current = name
    } else {
      // single select
      setSelectedNames(new Set([name]))
      lastClickedName.current = name
    }
  }

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    // Deselect when clicking empty area (not a table row)
    const target = e.target as HTMLElement
    if (!target.closest('tr')) {
      setSelectedNames(new Set())
      lastClickedName.current = null
    }
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  function handleRowContextMenu(e: React.MouseEvent, entry: SftpEntry) {
    e.preventDefault()
    e.stopPropagation()
    // If clicked row is not selected, make it single-selected
    if (!selectedNames.has(entry.name)) {
      setSelectedNames(new Set([entry.name]))
      lastClickedName.current = entry.name
    }
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  function selectedEntries(): SftpEntry[] {
    return entries.filter((e) => selectedNames.has(e.name))
  }

  async function ctxDelete() {
    setCtxMenu(null)
    const sel = selectedEntries()
    if (sel.length === 0) return
    const hasDir = sel.some((e) => e.type === 'dir')
    const msg =
      sel.length === 1
        ? sel[0].type === 'dir'
          ? `「${sel[0].name}」フォルダを削除しますか?\n中のファイルもすべて削除されます。`
          : `「${sel[0].name}」を削除しますか?`
        : `選択した ${sel.length} 件を削除しますか?${hasDir ? '\nフォルダは中身ごと削除されます。' : ''}`
    if (!confirm(msg)) return
    try {
      for (const entry of sel) {
        await api.sftp.remove(handle, joinPath(path, entry.name), entry.type === 'dir')
      }
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function ctxRename() {
    setCtxMenu(null)
    const sel = selectedEntries()
    if (sel.length !== 1) return
    setRenameInput(sel[0].name)
    setRenameModal({ entry: sel[0] })
  }

  async function doRename() {
    if (!renameModal || !renameInput.trim()) return
    try {
      await api.sftp.rename(handle, joinPath(path, renameModal.entry.name), joinPath(path, renameInput.trim()))
      setRenameModal(null)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function ctxDownload() {
    setCtxMenu(null)
    const sel = selectedEntries()
    if (sel.length === 0) return
    // ディレクトリは並列転送 API 未対応のため既存 API にフォールバック
    const hasDir = sel.some((e) => e.type === 'dir')
    if (hasDir) {
      try {
        await api.sftp.downloadMultiple(handle, sel.map((e) => joinPath(path, e.name)))
      } catch (e) {
        setError((e as Error).message)
      }
      return
    }

    // ファイルのみ: ダウンロード先を選択してから並列転送
    try {
      if (sel.length === 1) {
        // single file: Save ダイアログ
        const name = sel[0].name
        const filePath = await api.sftp.download(handle, joinPath(path, name), name)
        // sftp:download は内部で fastGet まで実行するため転送済み
        // 進捗を見せたい場合は将来改善。現状は既存 API をそのまま使用。
        void filePath
      } else {
        // multiple files: フォルダ選択ダイアログ後に並列転送
        const destDir = await api.dialog.openFiles().then(() => null).catch(() => null)
        // dialog:openFiles はファイル選択のため代わりに downloadMultiple の既存実装を利用
        // (フォルダ選択ダイアログは preload に未公開のため既存 API にフォールバック)
        await api.sftp.downloadMultiple(handle, sel.map((e) => joinPath(path, e.name)))
        void destDir
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function ctxCopyPath() {
    setCtxMenu(null)
    const sel = selectedEntries()
    const paths = sel.map((e) => joinPath(path, e.name)).join('\n')
    navigator.clipboard.writeText(paths).catch(() => undefined)
  }

  function ctxProperties() {
    setCtxMenu(null)
    const sel = selectedEntries()
    if (sel.length !== 1) return
    setPropsEntry({ entry: sel[0], fullPath: joinPath(path, sel[0].name) })
  }

  function ctxMove() {
    setCtxMenu(null)
    const sel = selectedEntries()
    if (sel.length === 0) return
    setMoveDestInput('')
    setMoveModal({ sources: sel.map((e) => joinPath(path, e.name)), mode: 'move' })
  }

  function ctxCopy() {
    setCtxMenu(null)
    const sel = selectedEntries()
    if (sel.length === 0) return
    setMoveDestInput('')
    setMoveModal({ sources: sel.map((e) => joinPath(path, e.name)), mode: 'copy' })
  }

  async function doMoveOrCopy() {
    if (!moveModal || !moveDestInput.trim()) return
    const dest = moveDestInput.trim()
    try {
      if (moveModal.mode === 'move') {
        await (api.sftp as any).movePath(handle, moveModal.sources, dest)
      } else {
        await (api.sftp as any).copyPath(handle, moveModal.sources, dest)
      }
      setMoveModal(null)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn('flex h-full w-full flex-col bg-bg', dragOver && 'ring-2 ring-accent ring-inset')}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-bg-soft px-2 py-1.5">
        <Button variant="ghost" onClick={up} title="上へ">
          <ArrowUp size={14} />
        </Button>
        <Button variant="ghost" onClick={refresh} title="更新">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </Button>
        <input
          className="mx-1 flex-1 rounded border border-border bg-bg-mute px-2 py-1 text-xs outline-none focus:border-accent"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refresh()}
        />
        <Button variant="ghost" onClick={makeDir} title="新規フォルダ">
          <FolderPlus size={14} />
        </Button>
        <Button variant="ghost" onClick={toggleHidden} title={showHidden ? '隠しファイルを非表示' : '隠しファイルを表示'}>
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
        <Button variant="ghost" onClick={upload} title="アップロード">
          <Upload size={14} />
        </Button>
      </div>

      {error && <div className="bg-rose-900/30 px-3 py-1 text-xs text-rose-300">{error}</div>}

      {/* File table */}
      <div className="flex-1 overflow-auto" onClick={handleContainerClick}>
        <table className="w-full text-xs">
          <thead className="bg-bg-soft text-fg-mute">
            <tr>
              <th className="px-2 py-1 text-left">名前</th>
              <th className="px-2 py-1 text-right">サイズ</th>
              <th className="px-2 py-1 text-left font-mono">権限</th>
              <th className="px-2 py-1 text-left">所有者</th>
              <th className="px-2 py-1 text-left">グループ</th>
              <th className="px-2 py-1 text-left">更新</th>
              <th className="w-32 px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((e) => {
              const isSelected = selectedNames.has(e.name)
              return (
                <tr
                  key={e.name}
                  className={cn(
                    'border-b border-border/50 cursor-default select-none',
                    isSelected
                      ? 'bg-accent/20 hover:bg-accent/30'
                      : 'hover:bg-bg-mute'
                  )}
                  onClick={(ev) => handleRowClick(ev, e)}
                  onDoubleClick={() => open(e)}
                  onContextMenu={(ev) => handleRowContextMenu(ev, e)}
                >
                  <td className="flex items-center gap-2 px-2 py-1 truncate">
                    {e.type === 'dir' ? (
                      <Folder size={14} className="text-accent" />
                    ) : (
                      <FileText size={14} className="text-fg-mute" />
                    )}
                    <span className="truncate">{e.name}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-fg-mute">
                    {e.type === 'file' ? humanBytes(e.size) : ''}
                  </td>
                  <td className="px-2 py-1 font-mono text-fg-mute">
                    {(e.type === 'dir' ? 'd' : e.type === 'link' ? 'l' : '-') + (e.permString ?? '')}
                  </td>
                  <td className="px-2 py-1 text-fg-mute">{e.owner ?? (e.uid >= 0 ? e.uid : '')}</td>
                  <td className="px-2 py-1 text-fg-mute">{e.group ?? (e.gid >= 0 ? e.gid : '')}</td>
                  <td className="px-2 py-1 text-fg-mute">
                    {e.mtime ? new Date(e.mtime).toLocaleString() : ''}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end gap-1">
                      {e.type === 'file' && (
                        <>
                          <button onClick={(ev) => { ev.stopPropagation(); editInline(e) }} className="p-0.5 text-fg-mute hover:text-fg" title="内蔵エディタで編集">
                            <FileText size={12} />
                          </button>
                          <button onClick={(ev) => { ev.stopPropagation(); openExternal(e) }} className="p-0.5 text-fg-mute hover:text-fg" title="外部で開く">
                            <ExternalLink size={12} />
                          </button>
                          <button onClick={(ev) => { ev.stopPropagation(); download(e) }} className="p-0.5 text-fg-mute hover:text-fg" title="ダウンロード">
                            <Download size={12} />
                          </button>
                        </>
                      )}
                      <button onClick={(ev) => { ev.stopPropagation(); removeSingle(e) }} className="p-0.5 text-fg-mute hover:text-rose-400" title="削除">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border border-border bg-bg-soft py-1 text-sm shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {selectedNames.size > 0 && (
            <CtxItem onClick={ctxDelete} danger>削除</CtxItem>
          )}
          {selectedNames.size === 1 && (
            <CtxItem onClick={ctxRename}>名前変更</CtxItem>
          )}
          {selectedNames.size > 0 && (
            <CtxItem onClick={ctxDownload}>ダウンロード</CtxItem>
          )}
          {selectedNames.size > 0 && (
            <CtxItem onClick={ctxCopyPath}>カレントパスをコピー</CtxItem>
          )}
          {selectedNames.size === 1 && (
            <CtxItem onClick={ctxProperties}>プロパティ</CtxItem>
          )}
          {selectedNames.size > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <CtxItem onClick={ctxMove}>移動先を指定して移動</CtxItem>
              <CtxItem onClick={ctxCopy}>コピー先を指定してコピー</CtxItem>
            </>
          )}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <EditorModal
          open={!!editing}
          path={editing.path}
          initialContents={editing.contents}
          theme={theme}
          onSave={saveEditor}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Per-file conflict dialog */}
      {conflictDialog && (
        <Modal
          open={!!conflictDialog}
          onOpenChange={(o) => {
            if (!o) {
              conflictDialog.resolve({ action: 'cancel', perFileActions: conflictDialog.perFileActions })
              setConflictDialog(null)
            }
          }}
          title="ファイルが既に存在します"
          width="max-w-2xl"
        >
          <div className="mb-3 flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setConflictDialog((prev) => {
                  if (!prev) return prev
                  const next: Record<string, FileAction> = {}
                  for (const k of Object.keys(prev.perFileActions)) next[k] = 'overwrite'
                  return { ...prev, perFileActions: next }
                })
              }}
            >
              全部上書き
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConflictDialog((prev) => {
                  if (!prev) return prev
                  const next: Record<string, FileAction> = {}
                  for (const k of Object.keys(prev.perFileActions)) next[k] = 'skip'
                  return { ...prev, perFileActions: next }
                })
              }}
            >
              全部スキップ
            </Button>
          </div>
          <div className="mb-4 max-h-64 overflow-auto rounded border border-border bg-bg-mute">
            {conflictDialog.conflicts.map((c) => (
              <div key={c} className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 last:border-0">
                <span className="flex-1 truncate font-mono text-xs text-fg-mute">{c}</span>
                <label className="flex cursor-pointer items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name={`conflict-${c}`}
                    value="overwrite"
                    checked={conflictDialog.perFileActions[c] === 'overwrite'}
                    onChange={() => {
                      setConflictDialog((prev) => {
                        if (!prev) return prev
                        return { ...prev, perFileActions: { ...prev.perFileActions, [c]: 'overwrite' } }
                      })
                    }}
                  />
                  上書き
                </label>
                <label className="flex cursor-pointer items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name={`conflict-${c}`}
                    value="skip"
                    checked={conflictDialog.perFileActions[c] === 'skip'}
                    onChange={() => {
                      setConflictDialog((prev) => {
                        if (!prev) return prev
                        return { ...prev, perFileActions: { ...prev.perFileActions, [c]: 'skip' } }
                      })
                    }}
                  />
                  スキップ
                </label>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                conflictDialog.resolve({ action: 'cancel', perFileActions: conflictDialog.perFileActions })
                setConflictDialog(null)
              }}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => {
                conflictDialog.resolve({ action: 'execute', perFileActions: conflictDialog.perFileActions })
                setConflictDialog(null)
              }}
            >
              実行
            </Button>
          </div>
        </Modal>
      )}

      {/* Properties modal */}
      {propsEntry && (
        <Modal
          open={!!propsEntry}
          onOpenChange={(o) => { if (!o) setPropsEntry(null) }}
          title="プロパティ"
          width="max-w-md"
        >
          <PropertiesView entry={propsEntry.entry} fullPath={propsEntry.fullPath} />
        </Modal>
      )}

      {/* Rename modal */}
      {renameModal && (
        <Modal
          open={!!renameModal}
          onOpenChange={(o) => { if (!o) setRenameModal(null) }}
          title="名前変更"
          width="max-w-sm"
        >
          <div className="mb-4">
            <label className="mb-1 block text-xs text-fg-mute">新しい名前</label>
            <Input
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doRename() }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenameModal(null)}>キャンセル</Button>
            <Button onClick={doRename}>変更</Button>
          </div>
        </Modal>
      )}

      {/* Transfer status bar */}
      <TransferStatusBar handle={handle} onRegister={handleRegister} />

      {/* Move / Copy modal */}
      {moveModal && (
        <Modal
          open={!!moveModal}
          onOpenChange={(o) => { if (!o) setMoveModal(null) }}
          title={moveModal.mode === 'move' ? '移動先を指定して移動' : 'コピー先を指定してコピー'}
          width="max-w-md"
        >
          <div className="mb-3 text-xs text-fg-mute">
            <p className="mb-1">対象 ({moveModal.sources.length} 件):</p>
            <ul className="max-h-24 overflow-auto rounded border border-border bg-bg-mute p-2 font-mono">
              {moveModal.sources.map((s) => <li key={s} className="truncate py-0.5">{s}</li>)}
            </ul>
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-xs text-fg-mute">宛先ディレクトリ (絶対パス)</label>
            <Input
              value={moveDestInput}
              onChange={(e) => setMoveDestInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doMoveOrCopy() }}
              placeholder="/home/user/dest"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMoveModal(null)}>キャンセル</Button>
            <Button onClick={doMoveOrCopy}>{moveModal.mode === 'move' ? '移動' : 'コピー'}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CtxItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full px-3 py-1.5 text-left hover:bg-bg-mute',
        danger && 'text-rose-400 hover:text-rose-300'
      )}
    >
      {children}
    </button>
  )
}

function PropertiesView({ entry, fullPath }: { entry: SftpEntry; fullPath: string }) {
  const typeLabel = entry.type === 'dir' ? 'ディレクトリ' : entry.type === 'link' ? 'シンボリックリンク' : 'ファイル'
  const modeOctal = entry.mode != null ? '0' + (entry.mode & 0o777).toString(8) : '-'
  const typeChar = entry.type === 'dir' ? 'd' : entry.type === 'link' ? 'l' : '-'
  const rows: [string, string][] = [
    ['パス', fullPath],
    ['種類', typeLabel],
    ['サイズ', entry.type === 'file' ? humanBytes(entry.size) + ` (${entry.size} bytes)` : '-'],
    ['権限', typeChar + (entry.permString ?? '') + `  (${modeOctal})`],
    ['所有者', entry.owner ? `${entry.owner} (uid: ${entry.uid})` : entry.uid >= 0 ? String(entry.uid) : '-'],
    ['グループ', entry.group ? `${entry.group} (gid: ${entry.gid})` : entry.gid >= 0 ? String(entry.gid) : '-'],
    ['更新日時', entry.mtime ? new Date(entry.mtime).toLocaleString() : '-'],
  ]
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-border/50 last:border-0">
            <td className="py-1.5 pr-3 text-xs font-medium text-fg-mute whitespace-nowrap">{label}</td>
            <td className="py-1.5 font-mono text-xs break-all">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
