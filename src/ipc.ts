import type { Api } from '../electron/preload'

declare global {
  interface Window {
    api: Api
  }
}

export const api = (window as any).api as Api
export type { SessionProfile, VaultEntry, VaultEntryPublic, VaultStatus, AppSettings, SftpEntry } from '../electron/shared/types'
