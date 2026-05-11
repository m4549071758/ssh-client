import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface BiometricProvider {
  readonly label: string
  isAvailable(): Promise<boolean>
  verify(reason: string): Promise<boolean>
}

const PROTECT_KEY_FILE = (): string => join(app.getPath('userData'), 'hello.dpapi')

function ensureUserDataDir(): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadProtectionKey(): Buffer | null {
  const path = PROTECT_KEY_FILE()
  if (!existsSync(path)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  const buf = readFileSync(path)
  const s = safeStorage.decryptString(buf)
  return s ? Buffer.from(s, 'base64') : null
}

export function saveProtectionKey(key: Buffer): void {
  ensureUserDataDir()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage is not available on this OS')
  }
  const enc = safeStorage.encryptString(key.toString('base64'))
  writeFileSync(PROTECT_KEY_FILE(), enc)
}

export function getOrCreateProtectionKey(): Buffer {
  const existing = loadProtectionKey()
  if (existing) return existing
  const fresh = randomBytes(32)
  saveProtectionKey(fresh)
  return fresh
}
