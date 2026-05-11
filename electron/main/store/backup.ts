import { writeFileSync, readFileSync } from 'node:fs'
import { sealWithPassword, openWithPassword, type SealedBlob } from './crypto'
import * as Vault from './vault'
import * as Sessions from './sessions'
import * as Settings from './settings'
import * as KnownHosts from './knownHosts'
import type { VaultEntry, SessionProfile, AppSettings, KnownHostEntry } from '../../shared/types'

interface BackupPayload {
  vault: { entries: VaultEntry[] }
  sessions: SessionProfile[]
  knownHosts: KnownHostEntry[]
  settings: AppSettings
}

interface BackupFile {
  type: 'ssh-client-backup'
  version: 1
  exportedAt: number
  encrypted: SealedBlob
}

export interface BackupSummary {
  exportedAt: number
  vaultEntries: number
  sessions: number
  knownHosts: number
}

/** バックアップを暗号化してファイルに書き出す。Vault が解錠されている必要がある。 */
export function exportToFile(filePath: string, password: string): BackupSummary {
  if (!password || password.length < 8) {
    throw new Error('Backup password must be at least 8 characters')
  }
  const payload: BackupPayload = {
    vault: { entries: Vault._exportAllEntries() },
    sessions: Sessions.listSessions(),
    knownHosts: KnownHosts.list(),
    settings: Settings.getSettings()
  }
  const json = JSON.stringify(payload)
  const sealed = sealWithPassword(password, Buffer.from(json, 'utf8'))
  const file: BackupFile = {
    type: 'ssh-client-backup',
    version: 1,
    exportedAt: Date.now(),
    encrypted: sealed
  }
  writeFileSync(filePath, JSON.stringify(file, null, 2), 'utf8')
  return {
    exportedAt: file.exportedAt,
    vaultEntries: payload.vault.entries.length,
    sessions: payload.sessions.length,
    knownHosts: payload.knownHosts.length
  }
}

/** バックアップファイルを読み込み・復号して全データを上書きする。 */
export function importFromFile(filePath: string, password: string): BackupSummary {
  const raw = readFileSync(filePath, 'utf8')
  let parsed: BackupFile
  try {
    parsed = JSON.parse(raw) as BackupFile
  } catch {
    throw new Error('Invalid backup file (not JSON)')
  }
  if (parsed.type !== 'ssh-client-backup' || parsed.version !== 1) {
    throw new Error('Unsupported backup file format')
  }
  let plain: Buffer
  try {
    plain = openWithPassword(password, parsed.encrypted)
  } catch {
    throw new Error('Wrong password or corrupted backup')
  }
  let payload: BackupPayload
  try {
    payload = JSON.parse(plain.toString('utf8')) as BackupPayload
  } catch {
    throw new Error('Decrypted payload is not valid')
  }

  Sessions.replaceAll(payload.sessions ?? [])
  KnownHosts.replaceAll(payload.knownHosts ?? [])
  if (payload.settings) {
    Settings.updateSettings(payload.settings as unknown)
  }

  // Vault エントリは解錠中のみ復元 (ロック中なら自動でスキップ)
  try {
    Vault._replaceAllEntries(payload.vault?.entries ?? [])
  } catch {
    /* Vault がロック中の場合はスキップ */
  }

  return {
    exportedAt: parsed.exportedAt,
    vaultEntries: payload.vault?.entries?.length ?? 0,
    sessions: payload.sessions?.length ?? 0,
    knownHosts: payload.knownHosts?.length ?? 0
  }
}
