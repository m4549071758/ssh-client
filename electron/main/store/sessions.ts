import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { SessionProfile } from '../../shared/types'

interface SessionsSchema {
  sessions: SessionProfile[]
}

const store = new Store<SessionsSchema>({
  name: 'sessions',
  defaults: { sessions: [] }
})

export function listSessions(): SessionProfile[] {
  return store.get('sessions')
}

export function upsertSession(input: Omit<SessionProfile, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }): SessionProfile {
  const all = store.get('sessions')
  const now = Date.now()
  if (input.id) {
    const idx = all.findIndex((s) => s.id === input.id)
    if (idx >= 0) {
      const merged: SessionProfile = { ...all[idx], ...input, id: input.id, updatedAt: now }
      all[idx] = merged
      store.set('sessions', all)
      return merged
    }
  }
  const created: SessionProfile = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now
  } as SessionProfile
  store.set('sessions', [...all, created])
  return created
}

export function deleteSession(id: string): void {
  store.set('sessions', store.get('sessions').filter((s) => s.id !== id))
}

export function getSession(id: string): SessionProfile | undefined {
  return store.get('sessions').find((s) => s.id === id)
}
