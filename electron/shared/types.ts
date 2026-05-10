export interface SessionProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey' | 'credentialRef'
  /** Vault entry id (used when authType=credentialRef OR for storing passphrase of privateKey) */
  credentialId?: string
  /** Path to private key file (when authType=privateKey) */
  privateKeyPath?: string
  /** UI hint */
  color?: string
  group?: string
  /** terminal initial cwd hint, etc. (currently unused) */
  initialPath?: string
  createdAt: number
  updatedAt: number
}

export interface VaultEntry {
  id: string
  label: string
  username?: string
  /** What this secret value represents */
  secretType: 'password' | 'passphrase' | 'privateKey'
  /** plain string value; only present in main-process memory after vault unlock */
  value: string
}

export type VaultEntryPublic = Omit<VaultEntry, 'value'>

export interface VaultStatus {
  hasMasterPassword: boolean
  isUnlocked: boolean
  helloEnrolled: boolean
  helloAvailable: boolean
}

export interface AppSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  theme: 'dark' | 'light' | 'solarized-dark'
  copyOnSelect: boolean
  bracketedPaste: boolean
  autoLockMinutes: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontFamily: "'Cascadia Code', 'Yu Gothic Mono', 'MS Gothic', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  theme: 'light',
  copyOnSelect: true,
  bracketedPaste: true,
  autoLockMinutes: 15
}

export interface SshOpenResult {
  handle: string
}

export interface SftpEntry {
  name: string
  type: 'file' | 'dir' | 'link' | 'other'
  size: number
  mtime: number
  mode: number
  uid: number
  gid: number
  owner?: string
  group?: string
  /** 'rwxr-xr-x' style */
  permString: string
}
