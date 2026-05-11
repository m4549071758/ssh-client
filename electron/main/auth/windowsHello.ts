import { spawn } from 'node:child_process'
import type { BiometricProvider } from './biometric'

function runPowerShell(script: string, timeoutMs = 30000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
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

export class WindowsHelloProvider implements BiometricProvider {
  readonly label = 'Windows Hello'
  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'win32') return false
    try {
      const { stdout } = await runPowerShell(HELLO_CHECK_SCRIPT, 10000)
      return /RESULT=Available/i.test(stdout)
    } catch { return false }
  }
  async verify(_reason: string): Promise<boolean> {
    if (process.platform !== 'win32') return false
    const { stdout } = await runPowerShell(HELLO_VERIFY_SCRIPT, 60000)
    return /RESULT=Verified/i.test(stdout)
  }
}
