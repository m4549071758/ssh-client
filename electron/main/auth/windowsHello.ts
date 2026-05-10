import { spawn } from 'node:child_process'
import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { sealWithKey, openWithKey, type SealedBlob } from '../store/crypto'
import { randomBytes } from 'node:crypto'

/**
 * Windows Hello integration via PowerShell bridge.
 *
 * UserConsentVerifier presents a Windows Hello prompt; on success we permit access
 * to a locally stored Hello-protection key, which wraps the vault DEK.
 *
 * The Hello-protection key is stored on disk encrypted with Electron's safeStorage
 * (DPAPI on Windows), bound to the OS user. The combination of DPAPI binding +
 * UserConsentVerifier prompt approximates a Hello-protected key release.
 */

const PROTECT_KEY_FILE = () => join(app.getPath('userData'), 'hello.dpapi')

function ensureUserDataDir(): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function loadProtectionKey(): Buffer | null {
  const path = PROTECT_KEY_FILE()
  if (!existsSync(path)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  const buf = readFileSync(path)
  return safeStorage.decryptString(buf) ? Buffer.from(safeStorage.decryptString(buf), 'base64') : null
}

function saveProtectionKey(key: Buffer): void {
  ensureUserDataDir()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage (DPAPI) is not available on this OS')
  }
  const enc = safeStorage.encryptString(key.toString('base64'))
  writeFileSync(PROTECT_KEY_FILE(), enc)
}

function getOrCreateProtectionKey(): Buffer {
  const existing = loadProtectionKey()
  if (existing) return existing
  const fresh = randomBytes(32)
  saveProtectionKey(fresh)
  return fresh
}

function runPowerShell(script: string, timeoutMs = 30000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Encode as UTF-16LE base64 for -EncodedCommand to avoid quoting / execution policy issues
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true
    })
    if (process.env.SSH_CLIENT_DEBUG_HELLO) {
      console.log('[hello] running script:', script)
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => ps.kill(), timeoutMs)
    ps.stdout.on('data', (d) => (stdout += d.toString()))
    ps.stderr.on('data', (d) => (stderr += d.toString()))
    ps.on('close', (code) => {
      clearTimeout(timer)
      if (process.env.SSH_CLIENT_DEBUG_HELLO) {
        console.log('[hello] code:', code, 'stdout:', JSON.stringify(stdout), 'stderr:', JSON.stringify(stderr))
      }
      resolve({ code: code ?? -1, stdout, stderr })
    })
    ps.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr })
    })
  })
}

const HELLO_CHECK_SCRIPT = `
try {
  [void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
  [void][Windows.Foundation.IAsyncOperation\`1,Windows.Foundation,ContentType=WindowsRuntime]
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $awaiterType = [System.WindowsRuntimeSystemExtensions]
  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
  $asyncOp = $awaiterType.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } | Select-Object -First 1
  $task = $asyncOp.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @($op))
  $task.Wait(5000) | Out-Null
  Write-Output ('RESULT=' + $task.Result)
} catch {
  Write-Output ('ERROR=' + $_.Exception.Message)
}
`

const HELLO_VERIFY_SCRIPT = `
try {
  [void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
  [void][Windows.Foundation.IAsyncOperation\`1,Windows.Foundation,ContentType=WindowsRuntime]
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $awaiterType = [System.WindowsRuntimeSystemExtensions]
  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('SSH Client: unlock credential vault')
  $asyncOp = $awaiterType.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } | Select-Object -First 1
  $task = $asyncOp.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))
  $task.Wait(60000) | Out-Null
  Write-Output ('RESULT=' + $task.Result)
} catch {
  Write-Output ('ERROR=' + $_.Exception.Message)
}
`

export async function isHelloAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    const { stdout } = await runPowerShell(HELLO_CHECK_SCRIPT, 10000)
    return /RESULT=Available/i.test(stdout)
  } catch {
    return false
  }
}

export async function verifyHello(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const { stdout } = await runPowerShell(HELLO_VERIFY_SCRIPT, 60000)
  return /RESULT=Verified/i.test(stdout)
}

export async function helloSeal(dek: Buffer): Promise<{ sealed: SealedBlob; helloBlob: string }> {
  if (!(await isHelloAvailable())) throw new Error('Windows Hello not available')
  const ok = await verifyHello()
  if (!ok) throw new Error('Windows Hello verification failed')
  const protKey = getOrCreateProtectionKey()
  try {
    const sealed = sealWithKey(protKey, dek)
    return { sealed: { ...sealed, salt: '' } as SealedBlob, helloBlob: 'dpapi-v1' }
  } finally {
    protKey.fill(0)
  }
}

export async function helloUnseal(sealed: SealedBlob, _helloBlob: string): Promise<Buffer> {
  if (!(await isHelloAvailable())) throw new Error('Windows Hello not available')
  const ok = await verifyHello()
  if (!ok) throw new Error('Windows Hello verification failed')
  const protKey = getOrCreateProtectionKey()
  try {
    return openWithKey(protKey, sealed)
  } finally {
    protKey.fill(0)
  }
}
