import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KDF_PARAMS = { N: 1 << 15, r: 8, p: 1, keyLen: 32 }
const ALG = 'aes-256-gcm'

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KDF_PARAMS.keyLen, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
    maxmem: 256 * 1024 * 1024
  })
}

export interface SealedBlob {
  /** version */
  v: 1
  /** base64 */
  salt: string
  iv: string
  tag: string
  ct: string
}

export function sealWithKey(key: Buffer, plaintext: Buffer): Omit<SealedBlob, 'salt'> & { salt?: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') }
}

export function openWithKey(key: Buffer, blob: { iv: string; tag: string; ct: string }): Buffer {
  const iv = Buffer.from(blob.iv, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const ct = Buffer.from(blob.ct, 'base64')
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

export function sealWithPassword(password: string, plaintext: Buffer): SealedBlob {
  const salt = randomBytes(16)
  const key = deriveKey(password, salt)
  try {
    const sealed = sealWithKey(key, plaintext)
    return { ...sealed, v: 1, salt: salt.toString('base64') }
  } finally {
    key.fill(0)
  }
}

export function openWithPassword(password: string, blob: SealedBlob): Buffer {
  const salt = Buffer.from(blob.salt, 'base64')
  const key = deriveKey(password, salt)
  try {
    return openWithKey(key, blob)
  } finally {
    key.fill(0)
  }
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
