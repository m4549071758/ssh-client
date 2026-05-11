import { create } from 'zustand'
import { api } from '../ipc'
import type { SessionProfile, VaultEntryPublic, VaultStatus, AppSettings } from '../ipc'

export interface Tab {
  id: string
  sessionId: string
  name: string
  handle?: string
  status: 'connecting' | 'ready' | 'error' | 'closed' | 'reconnecting'
  errorMessage?: string
}

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

  openTab: (sessionId: string) => string
  setTabHandle: (tabId: string, handle: string) => void
  setTabStatus: (tabId: string, status: Tab['status'], err?: string) => void
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
    const id = crypto.randomUUID()
    const tab: Tab = { id, sessionId, name: session.name, status: 'connecting' }
    set({ tabs: [...get().tabs, tab], activeTabId: id })
    return id
  },
  setTabHandle: (tabId, handle) => {
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, handle } : t)) })
  },
  setTabStatus: (tabId, status, err) => {
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, status, errorMessage: err } : t)) })
  },
  closeTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (tab?.handle) {
      api.ssh.close(tab.handle).catch(() => undefined)
    }
    const remaining = get().tabs.filter((t) => t.id !== tabId)
    let active = get().activeTabId
    if (active === tabId) active = remaining[remaining.length - 1]?.id ?? null
    set({ tabs: remaining, activeTabId: active })
  },
  setActive: (tabId) => set({ activeTabId: tabId })
}))
