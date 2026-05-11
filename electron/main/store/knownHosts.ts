import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export interface KnownHostEntry {
  host: string
  keyType: string
  fingerprint: string
  firstSeen: number
  lastSeen: number
}

interface KnownHostsFile {
  version: 1
  entries: KnownHostEntry[]
}

const FILE = () => join(app.getPath('userData'), 'known_hosts.json')

function load(): KnownHostsFile {
  if (!existsSync(FILE())) return { version: 1, entries: [] }
  try {
    return JSON.parse(readFileSync(FILE(), 'utf8')) as KnownHostsFile
  } catch {
    return { version: 1, entries: [] }
  }
}

function save(file: KnownHostsFile): void {
  writeFileSync(FILE(), JSON.stringify(file, null, 2), 'utf8')
}

export function computeFingerprint(keyBuffer: Buffer): string {
  const hash = createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '')
  return `SHA256:${hash}`
}

export function list(): KnownHostEntry[] {
  return load().entries
}

export function find(host: string): KnownHostEntry | undefined {
  return load().entries.find((e) => e.host === host)
}

export function upsert(host: string, keyType: string, fingerprint: string): void {
  const file = load()
  const now = Date.now()
  const idx = file.entries.findIndex((e) => e.host === host)
  if (idx >= 0) {
    file.entries[idx] = { ...file.entries[idx], keyType, fingerprint, lastSeen: now }
  } else {
    file.entries.push({ host, keyType, fingerprint, firstSeen: now, lastSeen: now })
  }
  save(file)
}

export function remove(host: string): void {
  const file = load()
  file.entries = file.entries.filter((e) => e.host !== host)
  save(file)
}

export function clear(): void {
  save({ version: 1, entries: [] })
}

export function replaceAll(entries: KnownHostEntry[]): void {
  save({ version: 1, entries: [...entries] })
}
