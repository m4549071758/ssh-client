import type { BiometricProvider } from './biometric'

export class NoopBiometricProvider implements BiometricProvider {
  readonly label = ''
  async isAvailable(): Promise<boolean> { return false }
  async verify(_reason: string): Promise<boolean> { return false }
}
