import { create } from 'zustand'
import { api } from '../ipc'
import type { SessionProfile, VaultEntryPublic, VaultStatus, AppSettings } from '../ipc'

// ── Pane tree types ────────────────────────────────────────────────────────

export interface LeafPane {
  kind: 'leaf'
  paneId: string
  sessionId: string
  handle: string | null
  status: 'idle' | 'connecting' | 'ready' | 'closed' | 'error' | 'reconnecting'
  errorMessage?: string
  /** ready になった時刻 (epoch ms) — 接続時間表示用 */
  connectedAt?: number
}

export interface SplitPane {
  kind: 'split'
  splitId: string
  direction: 'horizontal' | 'vertical'
  sizes: number[]
  children: PaneNode[]
}

export type PaneNode = LeafPane | SplitPane

export interface Tab {
  id: string
  name: string
  layout: PaneNode
  activePaneId: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function findPane(node: PaneNode, paneId: string): LeafPane | undefined {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? node : undefined
  }
  for (const child of node.children) {
    const found = findPane(child, paneId)
    if (found) return found
  }
  return undefined
}

export function collectLeaves(node: PaneNode): LeafPane[] {
  if (node.kind === 'leaf') return [node]
  return node.children.flatMap(collectLeaves)
}

/** ペインツリー内の指定 pane を updater で更新した新しいツリーを返す */
function updatePane(node: PaneNode, paneId: string, updater: (leaf: LeafPane) => LeafPane): PaneNode {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? updater(node) : node
  }
  return { ...node, children: node.children.map((c) => updatePane(c, paneId, updater)) }
}

/** 指定 leaf を SplitPane で置き換える */
function splitNode(node: PaneNode, paneId: string, direction: 'horizontal' | 'vertical', newLeaf: LeafPane): PaneNode {
  if (node.kind === 'leaf') {
    if (node.paneId !== paneId) return node
    const split: SplitPane = {
      kind: 'split',
      splitId: crypto.randomUUID(),
      direction,
      sizes: [50, 50],
      children: [node, newLeaf],
    }
    return split
  }
  return { ...node, children: node.children.map((c) => splitNode(c, paneId, direction, newLeaf)) }
}

/**
 * 指定 leaf を削除する。
 * 削除結果が split 1 子になった場合はその子で置換。
 * ルート削除の場合は null を返す。
 */
function removePane(node: PaneNode, paneId: string): PaneNode | null {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? null : node
  }
  const newChildren: PaneNode[] = []
  for (const child of node.children) {
    const result = removePane(child, paneId)
    if (result !== null) newChildren.push(result)
  }
  if (newChildren.length === 0) return null
  if (newChildren.length === 1) return newChildren[0]
  return { ...node, children: newChildren }
}

// ── Store ─────────────────────────────────────────────────────────────────

interface AppState {
  sessions: SessionProfile[]
  vault: { status: VaultStatus | null; entries: VaultEntryPublic[] }
  settings: AppSettings | null
  tabs: Tab[]
  activeTabId: string | null

  loadSessions: () => Promise<void>
  saveSession: (input: Omit<SessionProfile, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }) => Promise<SessionProfile>
  deleteSession: (id: string) => Promise<void>

  loadVault: () => Promise<void>
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>

  openTab: (sessionId: string) => { tabId: string; paneId: string }
  setPaneHandle: (tabId: string, paneId: string, handle: string) => void
  setPaneStatus: (tabId: string, paneId: string, status: LeafPane['status'], errorMessage?: string) => void
  setActivePane: (tabId: string, paneId: string) => void
  splitPane: (tabId: string, paneId: string, direction: 'horizontal' | 'vertical', newSessionId: string) => { newPaneId: string }
  closePane: (tabId: string, paneId: string) => void
  closeTab: (tabId: string) => void
  setActive: (tabId: string | null) => void
}

export const useApp = create<AppState>((set, get) => ({
  sessions: [],
  vault: { status: null, entries: [] },
  settings: null,
  tabs: [],
  activeTabId: null,

  loadSessions: async () => {
    const list = await api.sessions.list()
    set({ sessions: list })
  },
  saveSession: async (input) => {
    const saved = await api.sessions.save(input)
    await get().loadSessions()
    return saved
  },
  deleteSession: async (id) => {
    await api.sessions.delete(id)
    await get().loadSessions()
  },

  loadVault: async () => {
    const status = await api.vault.status()
    let entries: VaultEntryPublic[] = []
    if (status.isUnlocked) {
      try {
        entries = await api.vault.list()
      } catch {
        /* ignore */
      }
    }
    set({ vault: { status, entries } })
  },

  loadSettings: async () => {
    const s = await api.settings.get()
    set({ settings: s })
  },
  updateSettings: async (patch) => {
    const s = await api.settings.set(patch)
    set({ settings: s })
  },

  openTab: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error('Session not found')
    const tabId = crypto.randomUUID()
    const paneId = crypto.randomUUID()
    const leaf: LeafPane = { kind: 'leaf', paneId, sessionId, handle: null, status: 'connecting' }
    const tab: Tab = { id: tabId, name: session.name, layout: leaf, activePaneId: paneId }
    set({ tabs: [...get().tabs, tab], activeTabId: tabId })
    return { tabId, paneId }
  },

  setPaneHandle: (tabId, paneId, handle) => {
    set({
      tabs: get().tabs.map((t) =>
        t.id !== tabId ? t : { ...t, layout: updatePane(t.layout, paneId, (l) => ({ ...l, handle })) }
      ),
    })
  },

  setPaneStatus: (tabId, paneId, status, errorMessage) => {
    set({
      tabs: get().tabs.map((t) =>
        t.id !== tabId
          ? t
          : {
              ...t,
              layout: updatePane(t.layout, paneId, (l) => ({
                ...l,
                status,
                errorMessage,
                connectedAt:
                  status === 'ready' && !l.connectedAt
                    ? Date.now()
                    : status === 'closed' || status === 'error'
                      ? undefined
                      : l.connectedAt
              }))
            }
      ),
    })
  },

  setActivePane: (tabId, paneId) => {
    set({
      tabs: get().tabs.map((t) => (t.id !== tabId ? t : { ...t, activePaneId: paneId })),
    })
  },

  splitPane: (tabId, paneId, direction, newSessionId) => {
    const session = get().sessions.find((s) => s.id === newSessionId)
    if (!session) throw new Error('Session not found')
    const newPaneId = crypto.randomUUID()
    const newLeaf: LeafPane = {
      kind: 'leaf',
      paneId: newPaneId,
      sessionId: newSessionId,
      handle: null,
      status: 'connecting',
    }
    set({
      tabs: get().tabs.map((t) =>
        t.id !== tabId
          ? t
          : { ...t, layout: splitNode(t.layout, paneId, direction, newLeaf), activePaneId: newPaneId }
      ),
    })
    return { newPaneId }
  },

  closePane: (tabId, paneId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    // handleをcloseする
    const leaf = findPane(tab.layout, paneId)
    if (leaf?.handle) {
      api.ssh.close(leaf.handle).catch(() => undefined)
    }
    const newLayout = removePane(tab.layout, paneId)
    if (newLayout === null) {
      // ルートが消えた → タブ自体を閉じる
      get().closeTab(tabId)
      return
    }
    // activePaneId が削除されたペインなら別のリーフに切り替える
    let activePaneId = tab.activePaneId
    if (activePaneId === paneId) {
      const leaves = collectLeaves(newLayout)
      activePaneId = leaves[0]?.paneId ?? ''
    }
    set({
      tabs: get().tabs.map((t) => (t.id !== tabId ? t : { ...t, layout: newLayout, activePaneId })),
    })
  },

  closeTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (tab) {
      const leaves = collectLeaves(tab.layout)
      for (const leaf of leaves) {
        if (leaf.handle) {
          api.ssh.close(leaf.handle).catch(() => undefined)
        }
      }
    }
    const remaining = get().tabs.filter((t) => t.id !== tabId)
    let active = get().activeTabId
    if (active === tabId) active = remaining[remaining.length - 1]?.id ?? null
    set({ tabs: remaining, activeTabId: active })
  },

  setActive: (tabId) => set({ activeTabId: tabId }),
}))
