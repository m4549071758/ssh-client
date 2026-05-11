import { systemPreferences } from 'electron'
import type { BiometricProvider } from './biometric'

export class MacTouchIdProvider implements BiometricProvider {
  readonly label = 'Touch ID'
  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'darwin') return false
    try {
      return systemPreferences.canPromptTouchID()
    } catch { return false }
  }
  async verify(reason: string): Promise<boolean> {
    if (process.platform !== 'darwin') return false
    try {
      await systemPreferences.promptTouchID(reason)
      return true
    } catch { return false }
  }
}
