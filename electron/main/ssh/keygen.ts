import { utils } from 'ssh2'
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type KeyAlgorithm = 'ed25519' | 'rsa' | 'ecdsa'

export interface KeygenOptions {
  algorithm: KeyAlgorithm
  /** RSA: 2048 / 3072 / 4096、ECDSA: 256 / 384 / 521 */
  bits?: number
  /** 公開鍵末尾コメント */
  comment?: string
  /** 秘密鍵パスフレーズ (任意) */
  passphrase?: string
  /** 秘密鍵保存先 (絶対パス) */
  privateKeyPath: string
  /** 公開鍵保存先 (省略時は privateKeyPath + '.pub') */
  publicKeyPath?: string
}

export interface KeygenResult {
  privateKeyPath: string
  publicKeyPath: string
  publicKey: string
  fingerprint: string
}

function ensureDirFor(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export async function generateKeyPair(opts: KeygenOptions): Promise<KeygenResult> {
  const publicKeyPath = opts.publicKeyPath ?? opts.privateKeyPath + '.pub'
  if (existsSync(opts.privateKeyPath)) {
    throw new Error(`File already exists: ${opts.privateKeyPath}`)
  }
  if (existsSync(publicKeyPath)) {
    throw new Error(`File already exists: ${publicKeyPath}`)
  }

  const generateOptions: Record<string, unknown> = {
    comment: opts.comment ?? '',
  }
  if (opts.passphrase) {
    generateOptions.passphrase = opts.passphrase
    generateOptions.cipher = 'aes256-ctr'
  }
  if (opts.algorithm === 'rsa') {
    generateOptions.bits = opts.bits ?? 4096
  } else if (opts.algorithm === 'ecdsa') {
    generateOptions.bits = opts.bits ?? 256
  }

  // ssh2 v1 系: utils.generateKeyPairSync(type, opts)
  const fn = (utils as unknown as { generateKeyPairSync?: (a: string, o: unknown) => { private: string; public: string } }).generateKeyPairSync
  if (typeof fn !== 'function') {
    throw new Error('ssh2.utils.generateKeyPairSync is not available')
  }
  const keys = fn(opts.algorithm, generateOptions)

  ensureDirFor(opts.privateKeyPath)
  writeFileSync(opts.privateKeyPath, keys.private, { encoding: 'utf8', mode: 0o600 })
  writeFileSync(publicKeyPath, keys.public, { encoding: 'utf8', mode: 0o644 })

  try {
    chmodSync(opts.privateKeyPath, 0o600)
    chmodSync(publicKeyPath, 0o644)
  } catch {
    /* Windows では chmod が無効。無視 */
  }

  // OpenSSH 公開鍵の本体は base64 部分。fingerprint は簡易表示用にそのまま返す
  return {
    privateKeyPath: opts.privateKeyPath,
    publicKeyPath,
    publicKey: keys.public.trim(),
    fingerprint: extractFingerprint(keys.public)
  }
}

function extractFingerprint(publicKeyText: string): string {
  // OpenSSH 形式: "<algo> <base64> [comment]"
  const parts = publicKeyText.trim().split(/\s+/)
  if (parts.length < 2) return ''
  try {
    const buf = Buffer.from(parts[1], 'base64')
    const { createHash } = require('node:crypto') as typeof import('node:crypto')
    const hash = createHash('sha256').update(buf).digest('base64').replace(/=+$/, '')
    return `SHA256:${hash}`
  } catch {
    return ''
  }
}
