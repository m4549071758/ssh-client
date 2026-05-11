import { sealWithKey, openWithKey, type SealedBlob } from '../store/crypto'
import { getOrCreateProtectionKey, type BiometricProvider } from './biometric'
import { WindowsHelloProvider } from './windowsHello'
import { MacTouchIdProvider } from './macTouchId'
import { NoopBiometricProvider } from './linuxBiometric'

let cached: BiometricProvider | null = null
export function getBiometric(): BiometricProvider {
  if (cached) return cached
  if (process.platform === 'win32') cached = new WindowsHelloProvider()
  else if (process.platform === 'darwin') cached = new MacTouchIdProvider()
  else cached = new NoopBiometricProvider()
  return cached
}

export async function isHelloAvailable(): Promise<boolean> {
  return getBiometric().isAvailable()
}

export function getBiometricLabel(): string {
  return getBiometric().label
}

export async function helloSeal(dek: Buffer): Promise<{ sealed: SealedBlob; helloBlob: string }> {
  const bio = getBiometric()
  if (!(await bio.isAvailable())) throw new Error('Biometric authentication not available')
  const ok = await bio.verify('SSH Client: unlock credential vault')
  if (!ok) throw new Error('Biometric verification failed')
  const protKey = getOrCreateProtectionKey()
  try {
    const sealed = sealWithKey(protKey, dek)
    return { sealed: { ...sealed, salt: '' } as SealedBlob, helloBlob: 'protected-v1' }
  } finally {
    protKey.fill(0)
  }
}

export async function helloUnseal(sealed: SealedBlob, _helloBlob: string): Promise<Buffer> {
  const bio = getBiometric()
  if (!(await bio.isAvailable())) throw new Error('Biometric authentication not available')
  const ok = await bio.verify('SSH Client: unlock credential vault')
  if (!ok) throw new Error('Biometric verification failed')
  const protKey = getOrCreateProtectionKey()
  try {
    return openWithKey(protKey, sealed)
  } finally {
    protKey.fill(0)
  }
}
