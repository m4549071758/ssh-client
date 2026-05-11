import { Client, type ClientChannel, type SFTPWrapper, type ConnectConfig } from 'ssh2'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { SessionProfile, HostKeyDecision, HostKeyPromptInfo } from '../../shared/types'
import { _getEntrySecret } from '../store/vault'
import * as KnownHosts from '../store/knownHosts'
import * as Settings from '../store/settings'

/** ホスト鍵プロンプトの応答を待機するコールバック */
const pendingHostKeyPrompts = new Map<string, (decision: HostKeyDecision) => void>()

export function resolveHostKeyPrompt(handle: string, decision: HostKeyDecision): void {
  const resolve = pendingHostKeyPrompts.get(handle)
  if (resolve) {
    pendingHostKeyPrompts.delete(handle)
    resolve(decision)
  }
}

export interface SshAuthOverride {
  password?: string
  privateKeyPassphrase?: string
}

interface ActiveSession {
  id: string
  sessionId: string
  client: Client
  shell?: ClientChannel
  sftp?: SFTPWrapper
  /** C-1: 並行 SFTP 生成を防ぐ pending promise */
  sftpPending: Promise<SFTPWrapper> | null
  events: EventEmitter
  ready: boolean
  /** C-2: close イベントの二重 fire を防ぐフラグ */
  closed: boolean
  /** A5: 再接続制御フィールド */
  reconnecting: boolean
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  intentionalClose: boolean
  lastConnectOptions: OpenOptions
  lastProfile: SessionProfile
}

const RECONNECT_DELAYS = [2000, 5000, 10000, 20000, 30000]

const sessions = new Map<string, ActiveSession>()

function buildConnectConfig(
  profile: SessionProfile,
  handle: string,
  events: EventEmitter,
  override?: SshAuthOverride
): ConnectConfig {
  const settings = Settings.getSettings()
  const host = `${profile.host}:${profile.port || 22}`
  const cfg: ConnectConfig = {
    host: profile.host,
    port: profile.port || 22,
    username: profile.username,
    readyTimeout: 25000,
    hostVerifier: (keyBuffer: Buffer, callback: (valid: boolean) => void) => {
      const fingerprint = KnownHosts.computeFingerprint(keyBuffer)
      const existing = KnownHosts.find(host)

      if (existing) {
        if (existing.fingerprint === fingerprint) {
          // 一致: lastSeen を更新して続行
          KnownHosts.upsert(host, existing.keyType, fingerprint)
          callback(true)
          return
        }
        // 不一致: 警告ダイアログ
        const info: HostKeyPromptInfo = {
          host: profile.host,
          port: profile.port || 22,
          keyType: 'unknown',
          fingerprint,
          previousFingerprint: existing.fingerprint
        }
        pendingHostKeyPrompts.set(handle, (decision) => {
          if (decision === 'replace') {
            KnownHosts.upsert(host, 'unknown', fingerprint)
            callback(true)
          } else {
            callback(false)
          }
        })
        events.emit('hostKeyPrompt', info)
        return
      }

      // 未登録: TOFU
      const info: HostKeyPromptInfo = {
        host: profile.host,
        port: profile.port || 22,
        keyType: 'unknown',
        fingerprint
      }
      pendingHostKeyPrompts.set(handle, (decision) => {
        if (decision === 'accept') {
          KnownHosts.upsert(host, 'unknown', fingerprint)
          callback(true)
        } else {
          callback(false)
        }
      })
      events.emit('hostKeyPrompt', info)
    }
  }

  // A5: Keep-Alive 設定 (プロファイル優先、グローバルフォールバック)
  const interval = profile.keepaliveInterval ?? settings.keepaliveInterval
  const countMax = profile.keepaliveCountMax ?? settings.keepaliveCountMax
  if (interval > 0) {
    cfg.keepaliveInterval = interval
    cfg.keepaliveCountMax = countMax
  }

  if (profile.authType === 'password') {
    let pw = override?.password
    if (!pw && profile.credentialId) {
      const e = _getEntrySecret(profile.credentialId)
      if (e && e.secretType === 'password') pw = e.value
    }
    if (!pw) throw new Error('Password not provided (vault locked or missing)')
    cfg.password = pw
    return cfg
  }

  if (profile.authType === 'privateKey') {
    if (!profile.privateKeyPath) throw new Error('Private key path not set')
    const keyData = readFileSync(profile.privateKeyPath)
    cfg.privateKey = keyData
    let passphrase = override?.privateKeyPassphrase
    if (!passphrase && profile.credentialId) {
      const e = _getEntrySecret(profile.credentialId)
      if (e && e.secretType === 'passphrase') passphrase = e.value
    }
    if (passphrase) cfg.passphrase = passphrase
    return cfg
  }

  if (profile.authType === 'credentialRef') {
    if (!profile.credentialId) throw new Error('Credential ref not set')
    const e = _getEntrySecret(profile.credentialId)
    if (!e) throw new Error('Vault entry not found (vault may be locked)')
    if (e.secretType === 'password') {
      cfg.password = e.value
    } else if (e.secretType === 'privateKey') {
      cfg.privateKey = e.value
    } else {
      throw new Error('Vault entry must be password or privateKey')
    }
    return cfg
  }

  throw new Error('Unsupported authType')
}

export interface OpenOptions {
  cols?: number
  rows?: number
  override?: SshAuthOverride
}

/** A5: 再接続スケジュール */
function scheduleReconnect(handle: string): void {
  const session = sessions.get(handle)
  if (!session) return

  const settings = Settings.getSettings()
  const profile = session.lastProfile
  const shouldReconnect = profile.autoReconnect ?? settings.autoReconnect
  const maxRetries = profile.autoReconnectMaxRetries ?? settings.autoReconnectMaxRetries

  if (!shouldReconnect || session.reconnectAttempt >= maxRetries) {
    // 再接続しない or 上限超え: 通常 close 処理
    session.reconnecting = false
    sessions.delete(handle)
    session.events.emit('close')
    return
  }

  const attempt = session.reconnectAttempt
  const delayMs = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
  session.reconnecting = true
  session.reconnectAttempt = attempt + 1

  session.events.emit('reconnecting', { attempt: attempt + 1, delayMs })

  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null
    attemptReconnect(handle)
  }, delayMs)
}

/** A5: 再接続試行 */
function attemptReconnect(handle: string): void {
  const session = sessions.get(handle)
  if (!session) return

  // 古い client をクリーンアップ
  try { session.shell?.destroy() } catch { /* ignore */ }
  // A5: 再接続時は SFTP をリセット
  session.sftp = undefined
  session.sftpPending = null

  const newClient = new Client()
  session.client = newClient
  session.shell = undefined
  session.ready = false
  session.closed = false

  const profile = session.lastProfile
  const opts = session.lastConnectOptions

  newClient.on('ready', () => {
    session.ready = true
    newClient.shell({ term: 'xterm-256color', cols: opts.cols || 80, rows: opts.rows || 24 }, (err, channel) => {
      if (err) {
        // shell 取得失敗: 再度リトライ
        session.reconnecting = false
        newClient.end()
        return
      }
      session.shell = channel
      session.reconnecting = false
      session.reconnectAttempt = 0
      session.events.emit('ready')
      channel.on('data', (chunk: Buffer) => session.events.emit('data', chunk))
      channel.stderr.on('data', (chunk: Buffer) => session.events.emit('data', chunk))
      channel.on('close', () => {
        if (!session.intentionalClose && !session.closed) {
          session.closed = true
          scheduleReconnect(handle)
        }
      })
    })
  })

  newClient.on('error', (err) => {
    if (!session.intentionalClose) {
      session.events.emit('error', err.message)
      // エラー後の close イベントで scheduleReconnect が走るので ここでは何もしない
    }
  })

  newClient.on('close', () => {
    if (session.closed) return
    session.closed = true
    if (session.intentionalClose) {
      sessions.delete(handle)
      session.events.emit('close')
    } else {
      scheduleReconnect(handle)
    }
  })

  try {
    const cfg = buildConnectConfig(profile, handle, session.events, opts.override)
    newClient.connect(cfg)
  } catch (e) {
    session.events.emit('error', (e as Error).message)
    scheduleReconnect(handle)
  }
}

export function open(profile: SessionProfile, opts: OpenOptions = {}): { handle: string; events: EventEmitter } {
  const handle = randomUUID()
  const events = new EventEmitter()
  const client = new Client()
  const session: ActiveSession = {
    id: handle,
    sessionId: profile.id,
    client,
    events,
    ready: false,
    sftpPending: null,
    closed: false,
    reconnecting: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    intentionalClose: false,
    lastConnectOptions: opts,
    lastProfile: profile
  }
  sessions.set(handle, session)

  client.on('ready', () => {
    session.ready = true
    client.shell({ term: 'xterm-256color', cols: opts.cols || 80, rows: opts.rows || 24 }, (err, channel) => {
      if (err) {
        events.emit('error', err.message)
        client.end()
        return
      }
      session.shell = channel
      events.emit('ready')
      channel.on('data', (chunk: Buffer) => events.emit('data', chunk))
      channel.stderr.on('data', (chunk: Buffer) => events.emit('data', chunk))
      channel.on('close', () => {
        // shell チャンネルが閉じた場合: intentional でなければ再接続
        if (!session.intentionalClose && !session.closed) {
          session.closed = true
          scheduleReconnect(handle)
        }
      })
    })
  })

  client.on('error', (err) => {
    if (!session.intentionalClose) {
      events.emit('error', err.message)
    }
  })

  client.on('close', () => {
    // C-2: closed フラグで二重 fire を防ぐ
    if (session.closed) return
    session.closed = true
    if (session.intentionalClose) {
      sessions.delete(handle)
      events.emit('close')
    } else {
      scheduleReconnect(handle)
    }
  })

  try {
    const cfg = buildConnectConfig(profile, handle, events, opts.override)
    client.connect(cfg)
  } catch (e) {
    sessions.delete(handle)
    setImmediate(() => events.emit('error', (e as Error).message))
  }

  return { handle, events }
}

export function write(handle: string, data: string): void {
  const s = sessions.get(handle)
  if (s?.shell) s.shell.write(data)
}

export function resize(handle: string, cols: number, rows: number): void {
  const s = sessions.get(handle)
  if (s?.shell) {
    try {
      s.shell.setWindow(rows, cols, 0, 0)
    } catch {
      /* ignore */
    }
  }
}

export function close(handle: string): void {
  const s = sessions.get(handle)
  if (!s) return
  // A5: 明示的切断フラグを立てる
  s.intentionalClose = true
  // タイマーが有れば中止
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer)
    s.reconnectTimer = null
  }
  // m-6: shell.destroy() で即時破棄してから client.end()
  try {
    s.shell?.destroy()
  } catch {
    /* ignore */
  }
  // C-2: sessions.delete / events.emit('close') は client.on('close') で一元化する
  s.client.end()
}

export function getClient(handle: string): Client | undefined {
  return sessions.get(handle)?.client
}

export async function getSftp(handle: string): Promise<SFTPWrapper> {
  const s = sessions.get(handle)
  if (!s) throw new Error('SSH session not found')
  // C-1: 既存 SFTP ハンドル or pending promise を返し、並行生成を防ぐ
  if (s.sftp) return s.sftp
  if (!s.sftpPending) {
    s.sftpPending = new Promise((resolve, reject) => {
      s.client.sftp((err, sftp) => {
        if (err) {
          s.sftpPending = null
          return reject(err)
        }
        s.sftp = sftp
        s.sftpPending = null
        resolve(sftp)
      })
    })
  }
  return s.sftpPending
}

export function execCommand(
  handle: string,
  cmd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  const s = sessions.get(handle)
  if (!s) return Promise.reject(new Error('SSH session not found'))
  return new Promise((resolve, reject) => {
    s.client.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      stream.on('close', (code: number) => {
        resolve({ code: code ?? 0, stdout, stderr })
      })
      stream.on('error', reject)
    })
  })
}
