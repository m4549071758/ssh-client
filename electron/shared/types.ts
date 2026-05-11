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
  /** セッション単位のKeep-Alive / 再接続設定 (未指定ならグローバル値を使用) */
  keepaliveInterval?: number
  keepaliveCountMax?: number
  autoReconnect?: boolean
  autoReconnectMaxRetries?: number
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
  /** Keep-Alive 間隔 (ms)。0=無効 */
  keepaliveInterval: number
  /** Keep-Alive 許容失敗回数 */
  keepaliveCountMax: number
  /** 自動再接続を有効にするか */
  autoReconnect: boolean
  /** 自動再接続の最大試行回数 */
  autoReconnectMaxRetries: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontFamily: "'Cascadia Code', 'Yu Gothic Mono', 'MS Gothic', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  theme: 'light',
  copyOnSelect: true,
  bracketedPaste: true,
  autoLockMinutes: 15,
  keepaliveInterval: 30000,
  keepaliveCountMax: 3,
  autoReconnect: true,
  autoReconnectMaxRetries: 5
}

export interface SshOpenResult {
  handle: string
}

export interface KnownHostEntry {
  host: string
  keyType: string
  fingerprint: string
  firstSeen: number
  lastSeen: number
}

export type HostKeyDecision = 'accept' | 'replace' | 'reject'

export interface HostKeyPromptInfo {
  host: string
  port: number
  keyType: string
  fingerprint: string
  /** 既存登録がある場合の前回 fingerprint */
  previousFingerprint?: string
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
