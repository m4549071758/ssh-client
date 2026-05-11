import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { stat } from 'node:fs/promises'
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
}

const transfers = new Map<string, TransferStateInternal>()

export function getEmitter(transferId: string): EventEmitter | undefined {
  return transfers.get(transferId)?.emitter
}

export async function startUpload(
  handle: string,
  items: { local: string; remote: string; isDir: boolean }[]
): Promise<string> {
  const transferId = randomUUID()
  const emitter = new EventEmitter()

  const transferItems: TransferItem[] = []
  for (const it of items) {
    // ディレクトリはサイズ不明 (0)、ファイルは stat で取得
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
    emitter
  }
  transfers.set(transferId, state)

  // setImmediate でレンダラーが listener を貼る隙を確保してから開始
  setImmediate(() =>
    runTransfer(transferId).catch((e) => emitter.emit('error', (e as Error).message))
  )
  return transferId
}

export async function startDownload(
  handle: string,
  items: { remote: string; local: string; size?: number }[]
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
    localPaths: items.map((it) => it.local)
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

async function runTransfer(transferId: string): Promise<void> {
  const found = transfers.get(transferId)
  if (!found) return
  const t = found

  const sftp = await getSftpForHandle(t.handle)
  const settings = Settings.getSettings()
  const concurrency = Math.max(1, Math.min(10, settings.transferConcurrency ?? 4))

  let nextIdx = 0

  // 100ms debounce で進捗 emit
  let progressTimer: ReturnType<typeof setTimeout> | null = null
  const emitProgress = (): void => {
    if (progressTimer) return
    progressTimer = setTimeout(() => {
      progressTimer = null
      const evt = computeProgress(t)
      t.emitter.emit('progress', evt)
    }, 100)
  }

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
          await new Promise<void>((resolve, reject) => {
            sftp.fastPut(
              item.path,
              item.remote,
              {
                step: (transferred: number, _chunk: number, total: number) => {
                  item.transferred = transferred
                  if (total) item.size = total
                  emitProgress()
                }
              },
              (err) => (err ? reject(err) : resolve())
            )
          })
        } else {
          // ダウンロード: localPaths は startDownload で必ず設定される
          const localPath = (t.localPaths ?? [])[idx]
          if (!localPath) throw new Error(`No local path for index ${idx}`)
          await new Promise<void>((resolve, reject) => {
            sftp.fastGet(
              item.remote,
              localPath,
              {
                step: (transferred: number, _chunk: number, total: number) => {
                  item.transferred = transferred
                  if (total) item.size = total
                  emitProgress()
                }
              },
              (err) => (err ? reject(err) : resolve())
            )
          })
        }
        item.status = t.cancelled ? 'cancelled' : 'done'
      } catch (e) {
        item.status = 'failed'
        item.error = (e as Error).message
      }
      emitProgress()
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < concurrency; i++) workers.push(worker())
  await Promise.all(workers)

  // debounce を flush して最終状態を送信
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

  // レンダラー側の complete 受信を待ってからクリーンアップ
  setTimeout(() => transfers.delete(transferId), 30000)
}

function computeProgress(t: TransferStateInternal): TransferProgressEvent {
  let totalBytes = 0
  let transferredBytes = 0
  let completed = 0
  const active: TransferProgressEvent['active'] = []

  for (const it of t.items) {
    totalBytes += it.size
    transferredBytes +=
      it.status === 'done' ? it.size : it.transferred
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
