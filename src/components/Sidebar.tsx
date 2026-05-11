import { useMemo, useState } from 'react'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Edit2,
  Folder,
  FolderOpen,
  KeyRound,
  Lock,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Trash2,
  Unlock,
  Zap
} from 'lucide-react'
import type { SessionProfile, VaultStatus } from '../ipc'
import { Button, cn } from './ui'

interface Props {
  sessions: SessionProfile[]
  vaultStatus: VaultStatus | null
  onNewSession: () => void
  onEditSession: (s: SessionProfile) => void
  onDeleteSession: (s: SessionProfile) => void
  onConnect: (s: SessionProfile) => void
  onOpenVault: () => void
  onOpenSettings: () => void
  onQuickConnect: () => void
  onOpenKeygen: () => void
  onOpenBackup: () => void
}

interface FolderNode {
  name: string
  fullPath: string
  sessions: SessionProfile[]
  children: Map<string, FolderNode>
}

const UNCATEGORIZED = '__uncategorized__'
const COLLAPSED_KEY = 'ssh-client:sidebar:collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

function buildTree(sessions: SessionProfile[]): FolderNode {
  const root: FolderNode = { name: '', fullPath: '', sessions: [], children: new Map() }
  for (const s of sessions) {
    const path = (s.group ?? '').trim()
    if (!path) {
      let node = root.children.get(UNCATEGORIZED)
      if (!node) {
        node = { name: '(未分類)', fullPath: UNCATEGORIZED, sessions: [], children: new Map() }
        root.children.set(UNCATEGORIZED, node)
      }
      node.sessions.push(s)
      continue
    }
    const segments = path.split('/').map((p) => p.trim()).filter(Boolean)
    let current = root
    let acc = ''
    for (let i = 0; i < segments.length; i++) {
      acc = acc ? `${acc}/${segments[i]}` : segments[i]
      let next = current.children.get(segments[i])
      if (!next) {
        next = { name: segments[i], fullPath: acc, sessions: [], children: new Map() }
        current.children.set(segments[i], next)
      }
      current = next
    }
    current.sessions.push(s)
  }
  return root
}

function matchesQuery(s: SessionProfile, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const fields = [s.name, s.host, s.username, s.group ?? '', ...(s.tags ?? [])]
  return fields.some((f) => f.toLowerCase().includes(q))
}

function filterTree(node: FolderNode, query: string): FolderNode | null {
  if (!query) return node
  const sessions = node.sessions.filter((s) => matchesQuery(s, query))
  const children = new Map<string, FolderNode>()
  for (const [k, child] of node.children) {
    const filtered = filterTree(child, query)
    if (filtered) children.set(k, filtered)
  }
  if (sessions.length === 0 && children.size === 0) return null
  return { ...node, sessions, children }
}

export function Sidebar({
  sessions,
  vaultStatus,
  onNewSession,
  onEditSession,
  onDeleteSession,
  onConnect,
  onOpenVault,
  onOpenSettings,
  onQuickConnect,
  onOpenKeygen,
  onOpenBackup
}: Props) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed())

  const tree = useMemo(() => {
    const t = buildTree(sessions)
    return filterTree(t, query.trim()) ?? { name: '', fullPath: '', sessions: [], children: new Map() }
  }, [sessions, query])

  function toggleFolder(path: string): void {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setCollapsed(next)
    saveCollapsed(next)
  }

  // 検索中は自動展開
  const effectiveCollapsed = query.trim() ? new Set<string>() : collapsed

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-border bg-bg-soft">
      <div className="border-b border-border px-3 py-3">
        <h1 className="text-sm font-semibold tracking-wide">SSH Client</h1>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="検索 (名前 / ホスト / タグ)"
            className="w-full rounded border border-border bg-bg pl-7 pr-2 py-1 text-xs text-fg outline-none placeholder:text-fg-mute focus:border-accent"
          />
        </div>
        <button
          onClick={onQuickConnect}
          title="クイック接続 (user@host)"
          className="rounded p-1 text-fg-mute hover:bg-bg-mute hover:text-fg"
        >
          <Zap size={14} />
        </button>
        <button
          onClick={onNewSession}
          title="新規セッション"
          className="rounded p-1 text-fg-mute hover:bg-bg-mute hover:text-fg"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {sessions.length === 0 && (
          <p className="px-3 py-2 text-xs text-fg-mute">まだセッションがありません。+ から追加してください。</p>
        )}
        {sessions.length > 0 && tree.children.size === 0 && tree.sessions.length === 0 && (
          <p className="px-3 py-2 text-xs text-fg-mute">条件に一致するセッションがありません</p>
        )}
        <TreeView
          node={tree}
          depth={0}
          collapsed={effectiveCollapsed}
          onToggle={toggleFolder}
          onConnect={onConnect}
          onEdit={onEditSession}
          onDelete={onDeleteSession}
        />
      </div>

      <div className="border-t border-border p-2">
        <Button variant="ghost" className="mb-1 w-full justify-start" onClick={onOpenVault}>
          {vaultStatus?.isUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
          <span>Vault {vaultStatus?.isUnlocked ? '(unlocked)' : ''}</span>
        </Button>
        <Button variant="ghost" className="mb-1 w-full justify-start" onClick={onOpenKeygen}>
          <KeyRound size={14} />
          <span>SSH 鍵生成</span>
        </Button>
        <Button variant="ghost" className="mb-1 w-full justify-start" onClick={onOpenBackup}>
          <Archive size={14} />
          <span>バックアップ</span>
        </Button>
        <Button variant="ghost" className="w-full justify-start" onClick={onOpenSettings}>
          <SettingsIcon size={14} />
          <span>設定</span>
        </Button>
      </div>
    </aside>
  )
}

interface TreeViewProps {
  node: FolderNode
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  onConnect: (s: SessionProfile) => void
  onEdit: (s: SessionProfile) => void
  onDelete: (s: SessionProfile) => void
}

function TreeView({ node, depth, collapsed, onToggle, onConnect, onEdit, onDelete }: TreeViewProps): JSX.Element {
  const folderEntries = [...node.children.entries()].sort(([a], [b]) => {
    // (未分類) は最後
    if (a === UNCATEGORIZED) return 1
    if (b === UNCATEGORIZED) return -1
    return a.localeCompare(b)
  })

  return (
    <>
      {depth === 0 && node.sessions.map((s) => (
        <SessionRow key={s.id} session={s} depth={0} onConnect={onConnect} onEdit={onEdit} onDelete={onDelete} />
      ))}
      {folderEntries.map(([key, child]) => {
        const isCollapsed = collapsed.has(child.fullPath)
        const totalSessions = countSessions(child)
        return (
          <div key={key}>
            <button
              onClick={() => onToggle(child.fullPath)}
              className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs text-fg-mute hover:bg-bg-mute"
              style={{ paddingLeft: `${depth * 12 + 12}px` }}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {isCollapsed ? <Folder size={12} /> : <FolderOpen size={12} />}
              <span className="truncate">{child.name}</span>
              <span className="ml-auto text-fg-mute opacity-60">{totalSessions}</span>
            </button>
            {!isCollapsed && (
              <>
                {child.sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    depth={depth + 1}
                    onConnect={onConnect}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
                {child.children.size > 0 && (
                  <TreeView
                    node={child}
                    depth={depth + 1}
                    collapsed={collapsed}
                    onToggle={onToggle}
                    onConnect={onConnect}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                )}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

function countSessions(node: FolderNode): number {
  let count = node.sessions.length
  for (const c of node.children.values()) count += countSessions(c)
  return count
}

interface SessionRowProps {
  session: SessionProfile
  depth: number
  onConnect: (s: SessionProfile) => void
  onEdit: (s: SessionProfile) => void
  onDelete: (s: SessionProfile) => void
}

function SessionRow({ session, depth, onConnect, onEdit, onDelete }: SessionRowProps): JSX.Element {
  return (
    <div
      className={cn('group flex items-center justify-between gap-1 py-1 pr-3 hover:bg-bg-mute')}
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
    >
      <button
        onClick={() => onConnect(session)}
        className="flex flex-1 items-center gap-2 truncate text-left text-sm"
      >
        <Server size={14} className="shrink-0 text-accent" />
        <span className="truncate">{session.name}</span>
        {session.tags && session.tags.length > 0 && (
          <span className="ml-1 flex shrink-0 gap-1">
            {session.tags.slice(0, 2).map((t) => (
              <span
                key={t}
                className="inline-flex rounded bg-bg-mute px-1 py-0.5 text-[10px] text-fg-mute"
              >
                {t}
              </span>
            ))}
            {session.tags.length > 2 && (
              <span className="text-[10px] text-fg-mute">+{session.tags.length - 2}</span>
            )}
          </span>
        )}
        <ChevronRight size={12} className="ml-auto text-fg-mute opacity-0 group-hover:opacity-100" />
      </button>
      <button
        onClick={() => onEdit(session)}
        className="rounded p-1 text-fg-mute opacity-0 hover:text-fg group-hover:opacity-100"
        title="編集"
      >
        <Edit2 size={12} />
      </button>
      <button
        onClick={() => onDelete(session)}
        className="rounded p-1 text-fg-mute opacity-0 hover:text-rose-400 group-hover:opacity-100"
        title="削除"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
