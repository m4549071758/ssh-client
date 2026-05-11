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
  /** "/" 区切りの階層パス。例: "Production/AWS" */
  group?: string
  /** 自由なタグ。検索・バッジ表示に使用 */
  tags?: string[]
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

export type TransferKind = 'upload' | 'download'
export type TransferItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TransferItem {
  /** ファイル識別: アップなら local パス、ダウンなら remote パス */
  path: string
  /** SFTP 側のパス */
  remote: string
  /** 既知の場合のバイト数 (0 = 不明) */
  size: number
  transferred: number
  status: TransferItemStatus
  error?: string
}

export interface TransferState {
  transferId: string
  /** SSH handle */
  handle: string
  kind: TransferKind
  items: TransferItem[]
  startedAt: number
  cancelled: boolean
}

export interface TransferProgressEvent {
  transferId: string
  totalBytes: number
  transferredBytes: number
  /** 完了 + 失敗 + キャンセル */
  completed: number
  /** items.length */
  total: number
  active: { path: string; transferred: number; size: number }[]
}

export interface TransferCompleteEvent {
  transferId: string
  successCount: number
  failedFiles: { path: string; error: string }[]
  cancelled: boolean
}

export interface Snippet {
  id: string
  label: string
  content: string
  /** 行末改行を自動的に付与する */
  appendNewline: boolean
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
  /** 並列転送数 (1〜10、デフォルト 4) */
  transferConcurrency: number
  /** コマンドスニペット */
  snippets: Snippet[]
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
  autoReconnectMaxRetries: 5,
  transferConcurrency: 4,
  snippets: []
}

export interface SshOpenResult {
  handle: string
}

export interface ResourceSample {
  timestamp: number
  loadavg: { '1m': number; '5m': number; '15m': number } | null
  memory: { totalBytes: number; usedBytes: number; availableBytes: number } | null
  disk: { totalBytes: number; usedBytes: number; usedPercent: number } | null
  uptimeSeconds: number | null
  cpuCount: number | null
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
