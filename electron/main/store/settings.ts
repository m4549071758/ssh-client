import Store from 'electron-store'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS
})

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store.store }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (store as any).set(k, v)
  }
  return getSettings()
}
