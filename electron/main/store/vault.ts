import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  deriveKey,
  openWithKey,
  openWithPassword,
  sealWithKey,
  sealWithPassword,
  type SealedBlob
} from './crypto'
import type { VaultEntry, VaultEntryPublic, VaultStatus } from '../../shared/types'
import { isHelloAvailable, helloUnseal, helloSeal } from '../auth'

interface VaultData {
  version: 1
  entries: VaultEntry[]
}

interface VaultFile {
  version: 1
  /** master-password sealed DEK -> AES key wrapping content */
  master?: SealedBlob
  /** content sealed by DEK */
  content: SealedBlob | null
  /** Hello-protected DEK (optional) */
  hello?: { sealed: SealedBlob; helloBlob: string }
}

const VAULT_FILE = () => join(app.getPath('userData'), 'vault.json')

let dek: Buffer | null = null
let cache: VaultData | null = null
let lockTimer: NodeJS.Timeout | null = null

function load(): VaultFile {
  const path = VAULT_FILE()
  if (!existsSync(path)) {
    return { version: 1, content: null }
  }
  return JSON.parse(readFileSync(path, 'utf8')) as VaultFile
}

function save(file: VaultFile): void {
  writeFileSync(VAULT_FILE(), JSON.stringify(file, null, 2), { encoding: 'utf8' })
}

function ensureLoaded(): VaultData {
  if (!cache) cache = { version: 1, entries: [] }
  return cache
}

function persistContent(): void {
  if (!dek || !cache) throw new Error('Vault locked')
  const file = load()
  const sealed = sealWithKey(dek, Buffer.from(JSON.stringify(cache), 'utf8'))
  file.content = { ...sealed, salt: '' } as SealedBlob
  save(file)
}

function resetLockTimer(autoLockMinutes: number): void {
  if (lockTimer) clearTimeout(lockTimer)
  if (autoLockMinutes > 0) {
    lockTimer = setTimeout(() => lock(), autoLockMinutes * 60 * 1000)
  }
}

export async function status(): Promise<VaultStatus> {
  const file = load()
  const helloAvailable = await isHelloAvailable()
  return {
    hasMasterPassword: !!file.master,
    isUnlocked: dek !== null,
    helloEnrolled: !!file.hello,
    helloAvailable
  }
}

export async function setupMaster(password: string): Promise<void> {
  if (!password || password.length < 6) throw new Error('Master password must be at least 6 characters')
  const file = load()
  if (file.master) throw new Error('Master password already set')
  // create a new DEK
  const newDek = randomBytes(32)
  // wrap DEK using master password
  const wrap = sealWithPassword(password, newDek)
  // initialize empty content sealed by DEK
  const initial: VaultData = { version: 1, entries: [] }
  const sealedContent = sealWithKey(newDek, Buffer.from(JSON.stringify(initial), 'utf8'))
  file.master = wrap
  file.content = { ...sealedContent, salt: '' } as SealedBlob
  save(file)
  dek = newDek
  cache = initial
}

export async function unlockMaster(password: string, autoLockMinutes = 15): Promise<void> {
  const file = load()
  if (!file.master) throw new Error('Vault not initialized')
  // unwrap DEK
  const newDek = openWithPassword(password, file.master)
  let data: VaultData = { version: 1, entries: [] }
  if (file.content && file.content.ct) {
    try {
      const plain = openWithKey(newDek, file.content)
      data = JSON.parse(plain.toString('utf8')) as VaultData
    } catch (e) {
      newDek.fill(0)
      throw new Error('Vault corruption: unable to decrypt content')
    }
  }
  dek = newDek
  cache = data
  resetLockTimer(autoLockMinutes)
}

export async function changeMaster(oldPw: string, newPw: string): Promise<void> {
  await unlockMaster(oldPw)
  if (!dek) throw new Error('Unlock failed')
  const file = load()
  const wrap = sealWithPassword(newPw, dek)
  file.master = wrap
  // re-seal hello blob is unchanged because DEK is the same
  save(file)
}

export async function enrollHello(): Promise<void> {
  if (!dek) throw new Error('Vault locked')
  const file = load()
  const { sealed, helloBlob } = await helloSeal(dek)
  file.hello = { sealed, helloBlob }
  save(file)
}

export async function removeHello(): Promise<void> {
  const file = load()
  delete file.hello
  save(file)
}

export async function unlockHello(autoLockMinutes = 15): Promise<void> {
  const file = load()
  if (!file.hello) throw new Error('Hello not enrolled')
  const recovered = await helloUnseal(file.hello.sealed, file.hello.helloBlob)
  let data: VaultData = { version: 1, entries: [] }
  if (file.content && file.content.ct) {
    const plain = openWithKey(recovered, file.content)
    data = JSON.parse(plain.toString('utf8')) as VaultData
  }
  dek = recovered
  cache = data
  resetLockTimer(autoLockMinutes)
}

export function lock(): void {
  if (dek) {
    dek.fill(0)
    dek = null
  }
  cache = null
  if (lockTimer) {
    clearTimeout(lockTimer)
    lockTimer = null
  }
}

export function listEntries(): VaultEntryPublic[] {
  if (!dek || !cache) throw new Error('Vault locked')
  return cache.entries.map(({ value, ...rest }) => rest)
}

export function upsertEntry(entry: Omit<VaultEntry, 'id'> & { id?: string }): VaultEntryPublic {
  if (!dek || !cache) throw new Error('Vault locked')
  const data = ensureLoaded()
  if (entry.id) {
    const idx = data.entries.findIndex((e) => e.id === entry.id)
    if (idx >= 0) {
      data.entries[idx] = { ...data.entries[idx], ...entry, id: entry.id }
      persistContent()
      const { value, ...rest } = data.entries[idx]
      return rest
    }
  }
  const created: VaultEntry = { ...entry, id: randomUUID() } as VaultEntry
  data.entries.push(created)
  persistContent()
  const { value, ...rest } = created
  return rest
}

export function deleteEntry(id: string): void {
  if (!dek || !cache) throw new Error('Vault locked')
  cache.entries = cache.entries.filter((e) => e.id !== id)
  persistContent()
}

/** Returns the full plaintext entry (only for use in main process during ssh connect) */
export function _getEntrySecret(id: string): VaultEntry | undefined {
  if (!dek || !cache) return undefined
  return cache.entries.find((e) => e.id === id)
}
