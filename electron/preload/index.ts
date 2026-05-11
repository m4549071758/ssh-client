import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SessionProfile, VaultEntry, VaultEntryPublic, VaultStatus, AppSettings, SftpEntry, KnownHostEntry, HostKeyPromptInfo, HostKeyDecision, TransferProgressEvent, TransferCompleteEvent, ResourceSample } from '../shared/types'

export interface KeygenOptions {
  algorithm: 'ed25519' | 'rsa' | 'ecdsa'
  bits?: number
  comment?: string
  passphrase?: string
  privateKeyPath: string
  publicKeyPath?: string
}

export interface KeygenResult {
  privateKeyPath: string
  publicKeyPath: string
  publicKey: string
  fingerprint: string
}

export interface BackupSummary {
  exportedAt: number
  vaultEntries: number
  sessions: number
  knownHosts: number
}

export interface UploadItem {
  localPath: string
  remoteDir: string
}

export interface UploadEntry {
  local: string
  remote: string
  isDir: boolean
}

export interface UploadPlan {
  uploads: UploadEntry[]
  conflicts: string[]
}

export interface ExecuteUploadResult {
  uploaded: number
  skipped: number
}

export interface OpenExternalResult {
  tempPath: string
  watcherId: string
}

const api = {
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list') as Promise<SessionProfile[]>,
    save: (s: Omit<SessionProfile, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }) =>
      ipcRenderer.invoke('sessions:save', s) as Promise<SessionProfile>,
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id) as Promise<void>
  },
  vault: {
    status: () => ipcRenderer.invoke('vault:status') as Promise<VaultStatus>,
    setupMaster: (pw: string) => ipcRenderer.invoke('vault:setupMaster', pw) as Promise<void>,
    unlockMaster: (pw: string, autoLockMinutes: number) =>
      ipcRenderer.invoke('vault:unlockMaster', pw, autoLockMinutes) as Promise<void>,
    changeMaster: (oldPw: string, newPw: string) =>
      ipcRenderer.invoke('vault:changeMaster', oldPw, newPw) as Promise<void>,
    enrollHello: () => ipcRenderer.invoke('vault:enrollHello') as Promise<void>,
    removeHello: () => ipcRenderer.invoke('vault:removeHello') as Promise<void>,
    unlockHello: (autoLockMinutes: number) =>
      ipcRenderer.invoke('vault:unlockHello', autoLockMinutes) as Promise<void>,
    lock: () => ipcRenderer.invoke('vault:lock') as Promise<void>,
    list: () => ipcRenderer.invoke('vault:list') as Promise<VaultEntryPublic[]>,
    upsert: (e: Omit<VaultEntry, 'id'> & { id?: string }) =>
      ipcRenderer.invoke('vault:upsert', e) as Promise<VaultEntryPublic>,
    delete: (id: string) => ipcRenderer.invoke('vault:delete', id) as Promise<void>
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch) as Promise<AppSettings>,
    applyChrome: (theme: AppSettings['theme']) => ipcRenderer.invoke('settings:applyChrome', theme) as Promise<void>
  },
  ssh: {
    open: (sessionId: string, opts: { cols: number; rows: number; password?: string; passphrase?: string }) =>
      ipcRenderer.invoke('ssh:open', sessionId, opts) as Promise<string>,
    write: (handle: string, data: string) => ipcRenderer.invoke('ssh:write', handle, data) as Promise<void>,
    resize: (handle: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ssh:resize', handle, cols, rows) as Promise<void>,
    close: (handle: string) => ipcRenderer.invoke('ssh:close', handle) as Promise<void>,
    onReady: (handle: string, cb: () => void) => {
      const ch = `ssh:ready:${handle}`
      const listener = () => cb()
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    onData: (handle: string, cb: (chunk: Uint8Array) => void) => {
      const ch = `ssh:data:${handle}`
      const listener = (_: unknown, chunk: Buffer) => cb(new Uint8Array(chunk))
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    onClose: (handle: string, cb: () => void) => {
      const ch = `ssh:close:${handle}`
      const listener = () => cb()
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    onError: (handle: string, cb: (msg: string) => void) => {
      const ch = `ssh:error:${handle}`
      const listener = (_: unknown, msg: string) => cb(msg)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    onHostKeyPrompt: (handle: string, cb: (info: HostKeyPromptInfo) => void) => {
      const listener = (_e: unknown, info: HostKeyPromptInfo) => cb(info)
      ipcRenderer.on(`ssh:hostKeyPrompt:${handle}`, listener)
      return () => ipcRenderer.removeListener(`ssh:hostKeyPrompt:${handle}`, listener)
    },
    onReconnecting: (handle: string, cb: (info: { attempt: number; delayMs: number }) => void) => {
      const ch = `ssh:reconnecting:${handle}`
      const listener = (_: unknown, info: { attempt: number; delayMs: number }) => cb(info)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    hostKeyResponse: (handle: string, decision: HostKeyDecision) =>
      ipcRenderer.invoke('ssh:hostKeyResponse', handle, decision) as Promise<void>
  },
  knownHosts: {
    list: () => ipcRenderer.invoke('knownHosts:list') as Promise<KnownHostEntry[]>,
    remove: (host: string) => ipcRenderer.invoke('knownHosts:remove', host) as Promise<void>,
    clear: () => ipcRenderer.invoke('knownHosts:clear') as Promise<void>
  },
  sftp: {
    list: (handle: string, path: string) =>
      ipcRenderer.invoke('sftp:list', handle, path) as Promise<{ path: string; entries: SftpEntry[] }>,
    readFile: (handle: string, path: string) =>
      ipcRenderer.invoke('sftp:readFile', handle, path) as Promise<string>,
    writeFile: (handle: string, path: string, contents: string) =>
      ipcRenderer.invoke('sftp:writeFile', handle, path, contents) as Promise<void>,
    download: (handle: string, remote: string, defaultName: string) =>
      ipcRenderer.invoke('sftp:download', handle, remote, defaultName) as Promise<string | null>,
    upload: (handle: string, remoteDir: string) =>
      ipcRenderer.invoke('sftp:upload', handle, remoteDir) as Promise<string[]>,
    uploadPaths: (handle: string, remoteDir: string, paths: string[]) =>
      ipcRenderer.invoke('sftp:uploadPaths', handle, remoteDir, paths) as Promise<string[]>,
    rename: (handle: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('sftp:rename', handle, oldPath, newPath) as Promise<void>,
    remove: (handle: string, path: string, isDir: boolean) =>
      ipcRenderer.invoke('sftp:remove', handle, path, isDir) as Promise<void>,
    mkdir: (handle: string, path: string) =>
      ipcRenderer.invoke('sftp:mkdir', handle, path) as Promise<void>,
    planUpload: (handle: string, items: UploadItem[]) =>
      ipcRenderer.invoke('sftp:planUpload', handle, items) as Promise<UploadPlan>,
    executeUpload: (handle: string, uploads: UploadEntry[], conflictAction: 'overwrite' | 'skip' | 'per-file', perFileActions?: Record<string, 'overwrite' | 'skip'>) =>
      ipcRenderer.invoke('sftp:executeUpload', handle, uploads, conflictAction, perFileActions) as Promise<ExecuteUploadResult>,
    removeRecursive: (handle: string, path: string) =>
      ipcRenderer.invoke('sftp:removeRecursive', handle, path) as Promise<void>,
    movePath: (handle: string, sources: string[], destDir: string) =>
      ipcRenderer.invoke('sftp:movePath', handle, sources, destDir) as Promise<void>,
    copyPath: (handle: string, sources: string[], destDir: string) =>
      ipcRenderer.invoke('sftp:copyPath', handle, sources, destDir) as Promise<void>,
    downloadMultiple: (handle: string, remotes: string[]) =>
      ipcRenderer.invoke('sftp:downloadMultiple', handle, remotes) as Promise<string | null>,
    openExternal: (handle: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:openExternal', handle, remotePath) as Promise<OpenExternalResult>,
    closeExternal: (watcherId: string) =>
      ipcRenderer.invoke('sftp:closeExternal', watcherId) as Promise<void>,
    onPutBack: (cb: (info: { remotePath: string; ok: boolean; error?: string }) => void) => {
      const listener = (_: unknown, info: any) => cb(info)
      ipcRenderer.on('sftp:putback', listener)
      return () => ipcRenderer.removeListener('sftp:putback', listener)
    }
  },
  transfer: {
    startUpload: (handle: string, items: { local: string; remote: string; isDir: boolean }[]) =>
      ipcRenderer.invoke('transfer:startUpload', handle, items) as Promise<string>,
    startDownload: (handle: string, items: { remote: string; local: string; size?: number }[]) =>
      ipcRenderer.invoke('transfer:startDownload', handle, items) as Promise<string>,
    cancel: (transferId: string) =>
      ipcRenderer.invoke('transfer:cancel', transferId) as Promise<void>,
    retryFailed: (transferId: string) =>
      ipcRenderer.invoke('transfer:retryFailed', transferId) as Promise<string | null>,
    onProgress: (transferId: string, cb: (p: TransferProgressEvent) => void) => {
      const ch = `transfer:progress:${transferId}`
      const listener = (_: unknown, p: TransferProgressEvent) => cb(p)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    onComplete: (transferId: string, cb: (c: TransferCompleteEvent) => void) => {
      const ch = `transfer:complete:${transferId}`
      const listener = (_: unknown, c: TransferCompleteEvent) => cb(c)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    onError: (transferId: string, cb: (msg: string) => void) => {
      const ch = `transfer:error:${transferId}`
      const listener = (_: unknown, msg: string) => cb(msg)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    }
  },
  dialog: {
    openPrivateKey: () => ipcRenderer.invoke('dialog:openPrivateKey') as Promise<string | null>,
    openFiles: () => ipcRenderer.invoke('dialog:openFiles') as Promise<string[]>
  },
  fs: {
    pathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  hello: {
    available: () => ipcRenderer.invoke('hello:available') as Promise<boolean>,
    label: () => ipcRenderer.invoke('hello:label') as Promise<string>
  },
  keys: {
    defaultDir: () => ipcRenderer.invoke('keys:defaultDir') as Promise<string>,
    pickSaveDir: () => ipcRenderer.invoke('keys:pickSaveDir') as Promise<string | null>,
    generate: (opts: KeygenOptions) => ipcRenderer.invoke('keys:generate', opts) as Promise<KeygenResult>
  },
  backup: {
    exportBackup: (password: string) =>
      ipcRenderer.invoke('backup:export', password) as Promise<BackupSummary | null>,
    importBackup: (password: string) =>
      ipcRenderer.invoke('backup:import', password) as Promise<BackupSummary | null>
  },
  monitor: {
    start: (handle: string, intervalMs: number) =>
      ipcRenderer.invoke('monitor:start', handle, intervalMs) as Promise<string>,
    stop: (samplingId: string) =>
      ipcRenderer.invoke('monitor:stop', samplingId) as Promise<void>,
    onSample: (samplingId: string, cb: (s: ResourceSample) => void) => {
      const ch = `monitor:sample:${samplingId}`
      const listener = (_: unknown, s: ResourceSample) => cb(s)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
    onError: (samplingId: string, cb: (msg: string) => void) => {
      const ch = `monitor:error:${samplingId}`
      const listener = (_: unknown, msg: string) => cb(msg)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
