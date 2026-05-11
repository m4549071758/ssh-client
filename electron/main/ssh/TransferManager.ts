import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { stat } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { SFTPWrapper } from 'ssh2'
import { getSftpForHandle } from './SftpManager'
import * as Settings from '../store/settings'
import type {
  TransferKind,
  TransferItem,
  TransferState,
  TransferProgressEvent,
  TransferCompleteEvent
} from '../../shared/types'

/** ダウンロード時にローカルパスを紐づけるための内部拡張 */
interface TransferStateInternal extends TransferState {
  emitter: EventEmitter
  /** ダウンロード時のみ使用: items と同インデックスのローカル保存先パス */
  localPaths?: string[]
  /** レジューム転送モード (既存サイズから続ける)。デフォルト false = 上書き */
  resume: boolean
}

const transfers = new Map<string, TransferStateInternal>()

export function getEmitter(transferId: string): EventEmitter | undefined {
  return transfers.get(transferId)?.emitter
}

export async function startUpload(
  handle: string,
  items: { local: string; remote: string; isDir: boolean }[],
  options?: { resume?: boolean }
): Promise<string> {
  const transferId = randomUUID()
  const emitter = new EventEmitter()

  const transferItems: TransferItem[] = []
  for (const it of items) {
    const size = it.isDir ? 0 : (await stat(it.local).catch(() => ({ size: 0 }))).size
    transferItems.push({
      path: it.local,
      remote: it.remote,
      size,
      transferred: 0,
      status: 'pending'
    })
  }

  const state: TransferStateInternal = {
    transferId,
    handle,
    kind: 'upload' as TransferKind,
    items: transferItems,
    startedAt: Date.now(),
    cancelled: false,
    emitter,
    resume: options?.resume ?? false
  }
  transfers.set(transferId, state)

  setImmediate(() =>
    runTransfer(transferId).catch((e) => emitter.emit('error', (e as Error).message))
  )
  return transferId
}

export async function startDownload(
  handle: string,
  items: { remote: string; local: string; size?: number }[],
  options?: { resume?: boolean }
): Promise<string> {
  const transferId = randomUUID()
  const emitter = new EventEmitter()

  const transferItems: TransferItem[] = items.map((it) => ({
    path: it.remote,
    remote: it.remote,
    size: it.size ?? 0,
    transferred: 0,
    status: 'pending' as const
  }))

  const state: TransferStateInternal = {
    transferId,
    handle,
    kind: 'download' as TransferKind,
    items: transferItems,
    startedAt: Date.now(),
    cancelled: false,
    emitter,
    localPaths: items.map((it) => it.local),
    resume: options?.resume ?? false
  }
  transfers.set(transferId, state)

  setImmediate(() =>
    runTransfer(transferId).catch((e) => emitter.emit('error', (e as Error).message))
  )
  return transferId
}

export function cancel(transferId: string): void {
  const t = transfers.get(transferId)
  if (t) t.cancelled = true
}

/**
 * B2: 失敗ファイルのみをレジューム転送で再試行する。
 * 既存サイズからの続きを stream で書き込むためにバイト位置レジュームが効く。
 */
export async function retryFailed(transferId: string): Promise<string | null> {
  const orig = transfers.get(transferId)
  if (!orig) throw new Error('Transfer not found or already cleaned up')
  if (orig.kind === 'upload') {
    const items = orig.items
      .filter((it) => it.status === 'failed')
      .map((it) => ({ local: it.path, remote: it.remote, isDir: false }))
    if (items.length === 0) return null
    return startUpload(orig.handle, items, { resume: true })
  } else {
    const locals = orig.localPaths ?? []
    const items = orig.items
      .map((it, idx) => ({ it, idx }))
      .filter((x) => x.it.status === 'failed')
      .map((x) => ({ remote: x.it.remote, local: locals[x.idx], size: x.it.size }))
    if (items.length === 0) return null
    return startDownload(orig.handle, items, { resume: true })
  }
}

function sftpStat(sftp: SFTPWrapper, remote: string): Promise<{ size: number } | null> {
  return new Promise((resolve) => {
    sftp.stat(remote, (err, stats) => {
      if (err || !stats) resolve(null)
      else resolve({ size: stats.size })
    })
  })
}

async function transferOneUpload(
  sftp: SFTPWrapper,
  item: TransferItem,
  resume: boolean,
  onProgress: () => void,
  isCancelled: () => boolean
): Promise<void> {
  // 通常の総サイズ取得
  const localStat = await stat(item.path)
  item.size = localStat.size

  // レジューム時はリモートサイズから再開
  let start = 0
  if (resume) {
    const remoteStat = await sftpStat(sftp, item.remote)
    start = remoteStat?.size ?? 0
    if (start > localStat.size) {
      // リモートの方が大きい (=破損 or 別ファイル)。安全のため上書きに切替
      start = 0
    }
    if (start === localStat.size && start > 0) {
      // 既に完了済み
      item.transferred = start
      return
    }
  }

  const readStream = createReadStream(item.path, { start })
  const writeStream = sftp.createWriteStream(item.remote, {
    flags: start > 0 ? 'r+' : 'w',
    start
  } as unknown as Parameters<SFTPWrapper['createWriteStream']>[1])

  item.transferred = start
  onProgress()

  // 'data' で進捗更新
  readStream.on('data', (chunk: Buffer | string) => {
    const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    item.transferred += len
    onProgress()
    if (isCancelled()) {
      readStream.destroy()
      writeStream.destroy()
    }
  })

  await pipeline(readStream, writeStream)
}

async function transferOneDownload(
  sftp: SFTPWrapper,
  item: TransferItem,
  localPath: string,
  resume: boolean,
  onProgress: () => void,
  isCancelled: () => boolean
): Promise<void> {
  const remoteStat = await sftpStat(sftp, item.remote)
  const total = remoteStat?.size ?? 0
  item.size = total

  let start = 0
  if (resume) {
    try {
      const localStat = await stat(localPath)
      start = localStat.size
      if (start > total) start = 0
      if (start === total && start > 0) {
        item.transferred = start
        return
      }
    } catch {
      // ローカル未作成
    }
  }

  const readStream = sftp.createReadStream(item.remote, {
    start
  } as unknown as Parameters<SFTPWrapper['createReadStream']>[1])
  const writeStream = createWriteStream(localPath, {
    flags: start > 0 ? 'r+' : 'w',
    start
  })

  item.transferred = start
  onProgress()

  readStream.on('data', (chunk: Buffer | string) => {
    const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    item.transferred += len
    onProgress()
    if (isCancelled()) {
      readStream.destroy()
      writeStream.destroy()
    }
  })

  await pipeline(readStream, writeStream)
}

async function runTransfer(transferId: string): Promise<void> {
  const found = transfers.get(transferId)
  if (!found) return
  const t = found

  const sftp = await getSftpForHandle(t.handle)
  const settings = Settings.getSettings()
  const concurrency = Math.max(1, Math.min(10, settings.transferConcurrency ?? 4))

  let nextIdx = 0

  let progressTimer: ReturnType<typeof setTimeout> | null = null
  const emitProgress = (): void => {
    if (progressTimer) return
    progressTimer = setTimeout(() => {
      progressTimer = null
      t.emitter.emit('progress', computeProgress(t))
    }, 100)
  }

  const isCancelled = (): boolean => t.cancelled

  async function worker(): Promise<void> {
    while (true) {
      if (t.cancelled) return
      const idx = nextIdx++
      if (idx >= t.items.length) return
      const item = t.items[idx]
      item.status = 'running'
      emitProgress()

      try {
        if (t.kind === 'upload') {
          await transferOneUpload(sftp, item, t.resume, emitProgress, isCancelled)
        } else {
          const localPath = (t.localPaths ?? [])[idx]
          if (!localPath) throw new Error(`No local path for index ${idx}`)
          await transferOneDownload(sftp, item, localPath, t.resume, emitProgress, isCancelled)
        }
        item.status = t.cancelled ? 'cancelled' : 'done'
      } catch (e) {
        if (t.cancelled) {
          item.status = 'cancelled'
        } else {
          item.status = 'failed'
          item.error = (e as Error).message
        }
      }
      emitProgress()
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < concurrency; i++) workers.push(worker())
  await Promise.all(workers)

  if (progressTimer) {
    clearTimeout(progressTimer)
    progressTimer = null
  }
  t.emitter.emit('progress', computeProgress(t))

  const successCount = t.items.filter((it) => it.status === 'done').length
  const failedFiles = t.items
    .filter((it) => it.status === 'failed')
    .map((it) => ({ path: it.path, error: it.error ?? 'unknown' }))
  const complete: TransferCompleteEvent = {
    transferId,
    successCount,
    failedFiles,
    cancelled: t.cancelled
  }
  t.emitter.emit('complete', complete)

  setTimeout(() => transfers.delete(transferId), 30000)
}

function computeProgress(t: TransferStateInternal): TransferProgressEvent {
  let totalBytes = 0
  let transferredBytes = 0
  let completed = 0
  const active: TransferProgressEvent['active'] = []

  for (const it of t.items) {
    totalBytes += it.size
    transferredBytes += it.status === 'done' ? it.size : it.transferred
    if (it.status === 'done' || it.status === 'failed' || it.status === 'cancelled') {
      completed++
    }
    if (it.status === 'running') {
      active.push({ path: it.path, transferred: it.transferred, size: it.size })
    }
  }

  return {
    transferId: t.transferId,
    totalBytes,
    transferredBytes,
    completed,
    total: t.items.length,
    active
  }
}
