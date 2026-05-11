import Store from 'electron-store'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS
})

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store.store }
}

const VALID_THEMES = new Set<string>(['light', 'dark', 'solarized-dark'])

/** sec-M-5: ホワイトリスト + 型チェックで安全なパッチのみ適用 */
export function updateSettings(patch: unknown): AppSettings {
  if (typeof patch !== 'object' || patch === null) throw new Error('Invalid settings patch')
  const safePatch: Partial<AppSettings> = {}
  const p = patch as Record<string, unknown>

  if ('fontFamily' in p) {
    if (typeof p['fontFamily'] !== 'string' || p['fontFamily'].length > 200) throw new Error('Invalid fontFamily')
    safePatch.fontFamily = p['fontFamily']
  }
  if ('fontSize' in p) {
    if (typeof p['fontSize'] !== 'number' || p['fontSize'] < 8 || p['fontSize'] > 32) throw new Error('Invalid fontSize (8-32)')
    safePatch.fontSize = p['fontSize']
  }
  if ('lineHeight' in p) {
    if (typeof p['lineHeight'] !== 'number' || p['lineHeight'] < 0.8 || p['lineHeight'] > 2.5) throw new Error('Invalid lineHeight (0.8-2.5)')
    safePatch.lineHeight = p['lineHeight']
  }
  if ('theme' in p) {
    if (typeof p['theme'] !== 'string' || !VALID_THEMES.has(p['theme'])) throw new Error('Invalid theme')
    safePatch.theme = p['theme'] as AppSettings['theme']
  }
  if ('copyOnSelect' in p) {
    if (typeof p['copyOnSelect'] !== 'boolean') throw new Error('Invalid copyOnSelect')
    safePatch.copyOnSelect = p['copyOnSelect']
  }
  if ('bracketedPaste' in p) {
    if (typeof p['bracketedPaste'] !== 'boolean') throw new Error('Invalid bracketedPaste')
    safePatch.bracketedPaste = p['bracketedPaste']
  }
  if ('autoLockMinutes' in p) {
    if (typeof p['autoLockMinutes'] !== 'number' || p['autoLockMinutes'] < 0 || p['autoLockMinutes'] > 1440) throw new Error('Invalid autoLockMinutes (0-1440)')
    safePatch.autoLockMinutes = p['autoLockMinutes']
  }
  if ('keepaliveInterval' in p) {
    if (typeof p['keepaliveInterval'] !== 'number' || p['keepaliveInterval'] < 0 || p['keepaliveInterval'] > 300000) throw new Error('Invalid keepaliveInterval (0-300000)')
    safePatch.keepaliveInterval = p['keepaliveInterval']
  }
  if ('keepaliveCountMax' in p) {
    if (typeof p['keepaliveCountMax'] !== 'number' || p['keepaliveCountMax'] < 1 || p['keepaliveCountMax'] > 20) throw new Error('Invalid keepaliveCountMax (1-20)')
    safePatch.keepaliveCountMax = p['keepaliveCountMax']
  }
  if ('autoReconnect' in p) {
    if (typeof p['autoReconnect'] !== 'boolean') throw new Error('Invalid autoReconnect')
    safePatch.autoReconnect = p['autoReconnect']
  }
  if ('autoReconnectMaxRetries' in p) {
    if (typeof p['autoReconnectMaxRetries'] !== 'number' || p['autoReconnectMaxRetries'] < 0 || p['autoReconnectMaxRetries'] > 20) throw new Error('Invalid autoReconnectMaxRetries (0-20)')
    safePatch.autoReconnectMaxRetries = p['autoReconnectMaxRetries']
  }
  if ('transferConcurrency' in p) {
    if (typeof p['transferConcurrency'] !== 'number' || p['transferConcurrency'] < 1 || p['transferConcurrency'] > 10) throw new Error('Invalid transferConcurrency (1-10)')
    safePatch.transferConcurrency = p['transferConcurrency']
  }

  for (const [k, v] of Object.entries(safePatch)) {
    if (v !== undefined) (store as unknown as { set: (k: string, v: unknown) => void }).set(k, v)
  }
  return getSettings()
}
