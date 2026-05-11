import type { Api } from '../electron/preload'

declare global {
  interface Window {
    api: Api
  }
}

// n-2: Window インターフェースに api を宣言済みなので window.api で型安全にアクセス
export const api = window.api
export type { SessionProfile, VaultEntry, VaultEntryPublic, VaultStatus, AppSettings, SftpEntry } from '../electron/shared/types'
