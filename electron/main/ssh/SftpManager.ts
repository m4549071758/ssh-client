import { posix as posixPath } from 'node:path'
import * as nodePath from 'node:path'
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, rmSync, watch, watchFile, unwatchFile, FSWatcher } from 'node:fs'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { shell } from 'electron'
import type { SFTPWrapper, FileEntry } from 'ssh2'

// Minimal Stats interface matching ssh2-streams Stats shape
interface Stats {
  size: number
  mtime: number
  mode: number
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}
import { getSftp, execCommand } from './SshManager'
import type { SftpEntry } from '../../shared/types'

function categorize(stats: Stats): SftpEntry['type'] {
  if (stats.isDirectory()) return 'dir'
  if (stats.isSymbolicLink()) return 'link'
  if (stats.isFile()) return 'file'
  return 'other'
}

function modeToPermString(mode: number): string {
  const r = (m: number, b: number) => ((m & b) ? 'r' : '-')
  const w = (m: number, b: number) => ((m & b) ? 'w' : '-')
  const x = (m: number, b: number) => ((m & b) ? 'x' : '-')
  return (
    r(mode, 0o400) + w(mode, 0o200) + x(mode, 0o100) +
    r(mode, 0o040) + w(mode, 0o020) + x(mode, 0o010) +
    r(mode, 0o004) + w(mode, 0o002) + x(mode, 0o001)
  )
}

function parseLongname(longname: string): { owner?: string; group?: string } {
  // typical longname: "-rw-r--r--   1 user group       1234 Jan 1 12:34 file"
  const parts = longname.split(/\s+/)
  if (parts.length >= 4) {
    return { owner: parts[2], group: parts[3] }
  }
  return {}
}

export async function list(handle: string, path: string): Promise<{ path: string; entries: SftpEntry[] }> {
  const sftp = await getSftp(handle)
  const realpath = await new Promise<string>((resolve, reject) => {
    sftp.realpath(path || '.', (err, abs) => (err ? reject(err) : resolve(abs)))
  })
  const entries_raw = await new Promise<{ filename: string; longname: string; attrs: Stats & { uid?: number; gid?: number } }[]>((resolve, reject) => {
    sftp.readdir(realpath, (err, entries) => (err ? reject(err) : resolve(entries as any)))
  })
  // n-3: ローカル変数名を関数名 list と衝突しないよう entries_raw に変更
  const entries: SftpEntry[] = entries_raw
    .filter((e) => e.filename !== '.' && e.filename !== '..')
    .map((e) => {
      const { owner, group } = parseLongname(e.longname || '')
      return {
        name: e.filename,
        type: categorize(e.attrs),
        size: e.attrs.size,
        mtime: (e.attrs.mtime ?? 0) * 1000,
        mode: e.attrs.mode,
        uid: e.attrs.uid ?? -1,
        gid: e.attrs.gid ?? -1,
        owner,
        group,
        permString: modeToPermString(e.attrs.mode)
      }
    })
    .sort((a, b) => {
      // M-1: 型に優先順位を付けて正しく比較
      const order: Record<SftpEntry['type'], number> = { dir: 0, link: 1, file: 2, other: 3 }
      if (a.type !== b.type) return order[a.type] - order[b.type]
      return a.name.localeCompare(b.name)
    })
  return { path: realpath, entries }
}

export async function readFile(handle: string, remotePath: string, maxBytes = 5 * 1024 * 1024): Promise<string> {
  const sftp = await getSftp(handle)
  const stats = await new Promise<Stats>((resolve, reject) =>
    sftp.stat(remotePath, (err, s) => (err ? reject(err) : resolve(s as Stats)))
  )
  if (stats.size > maxBytes) throw new Error(`File too large (${stats.size} bytes > ${maxBytes})`)
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = sftp.createReadStream(remotePath)
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
  return buf.toString('utf8')
}

export async function writeFile(handle: string, remotePath: string, contents: string): Promise<void> {
  const sftp = await getSftp(handle)
  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath)
    stream.on('close', () => resolve())
    stream.on('error', reject)
    stream.end(Buffer.from(contents, 'utf8'))
  })
}

export async function downloadToFile(handle: string, remotePath: string, localPath: string): Promise<void> {
  const sftp = await getSftp(handle)
  await new Promise<void>((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()))
  })
}

export async function uploadFromFile(handle: string, localPath: string, remotePath: string): Promise<void> {
  const sftp = await getSftp(handle)
  await new Promise<void>((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => (err ? reject(err) : resolve()))
  })
}

export async function rename(handle: string, oldPath: string, newPath: string): Promise<void> {
  const sftp = await getSftp(handle)
  await new Promise<void>((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()))
  })
}

export async function remove(handle: string, path: string, isDir: boolean): Promise<void> {
  if (!isDir) {
    const sftp = await getSftp(handle)
    await new Promise<void>((resolve, reject) => sftp.unlink(path, (err) => (err ? reject(err) : resolve())))
    return
  }
  // For directories, try rmdir first; fall back to rm -rf
  const sftp = await getSftp(handle)
  try {
    await new Promise<void>((resolve, reject) => sftp.rmdir(path, (err) => (err ? reject(err) : resolve())))
  } catch {
    await removeRecursive(handle, path)
  }
}

export async function removeRecursive(handle: string, path: string): Promise<void> {
  const quoted = "'" + path.replace(/'/g, "'\\''") + "'"
  const result = await execCommand(handle, `rm -rf ${quoted}`)
  if (result.code !== 0) {
    throw new Error(`rm -rf failed (exit ${result.code}): ${result.stderr.trim()}`)
  }
}

export async function mkdir(handle: string, path: string): Promise<void> {
  const sftp = await getSftp(handle)
  await new Promise<void>((resolve, reject) => sftp.mkdir(path, (err) => (err ? reject(err) : resolve())))
}

export function joinPath(parent: string, name: string): string {
  return posixPath.join(parent, name)
}

export function dirname(p: string): string {
  return posixPath.dirname(p)
}

// ─── New functions for requirements ───────────────────────────────────────────

export async function existsRemote(handle: string, remotePath: string): Promise<boolean> {
  const sftp = await getSftp(handle)
  return new Promise<boolean>((resolve) => {
    sftp.stat(remotePath, (err) => resolve(!err))
  })
}

export interface WalkItem {
  absLocal: string
  relPath: string
  isDir: boolean
}

export function walkLocal(localPath: string): WalkItem[] {
  const items: WalkItem[] = []
  const stat = statSync(localPath)
  if (!stat.isDirectory()) {
    // single file
    items.push({ absLocal: localPath, relPath: nodePath.basename(localPath), isDir: false })
    return items
  }
  // directory: recurse
  const baseName = nodePath.basename(localPath)
  items.push({ absLocal: localPath, relPath: baseName, isDir: true })
  function recurse(dir: string, prefix: string) {
    const children = readdirSync(dir, { withFileTypes: true })
    for (const child of children) {
      const abs = nodePath.join(dir, child.name)
      const rel = prefix + '/' + child.name
      if (child.isDirectory()) {
        items.push({ absLocal: abs, relPath: rel, isDir: true })
        recurse(abs, rel)
      } else {
        items.push({ absLocal: abs, relPath: rel, isDir: false })
      }
    }
  }
  recurse(localPath, baseName)
  return items
}

export interface UploadPlan {
  uploads: { local: string; remote: string; isDir: boolean }[]
  conflicts: string[]
}

export async function planUpload(
  handle: string,
  items: { localPath: string; remoteDir: string }[]
): Promise<UploadPlan> {
  const uploads: { local: string; remote: string; isDir: boolean }[] = []
  const conflicts: string[] = []

  for (const item of items) {
    const walked = walkLocal(item.localPath)
    for (const w of walked) {
      const remote = posixPath.join(item.remoteDir, w.relPath.replace(/\\/g, '/'))
      uploads.push({ local: w.absLocal, remote, isDir: w.isDir })
      if (!w.isDir) {
        const exists = await existsRemote(handle, remote)
        if (exists) conflicts.push(remote)
      }
    }
  }

  return { uploads, conflicts }
}

export async function executeUpload(
  handle: string,
  uploads: { local: string; remote: string; isDir: boolean }[],
  conflictAction: 'overwrite' | 'skip' | 'per-file',
  perFileActions?: Record<string, 'overwrite' | 'skip'>
): Promise<{ uploaded: number; skipped: number }> {
  const sftp = await getSftp(handle)
  let uploaded = 0
  let skipped = 0

  for (const item of uploads) {
    if (item.isDir) {
      // mkdir, ignore error if already exists
      await new Promise<void>((resolve) => {
        sftp.mkdir(item.remote, (err) => {
          void err // ignore already-exists errors
          resolve()
        })
      })
    } else {
      // check conflict
      const exists = await new Promise<boolean>((resolve) => {
        sftp.stat(item.remote, (err) => resolve(!err))
      })
      if (exists) {
        let action: 'overwrite' | 'skip' = 'overwrite'
        if (conflictAction === 'skip') {
          action = 'skip'
        } else if (conflictAction === 'per-file') {
          action = perFileActions?.[item.remote] ?? 'overwrite'
        }
        if (action === 'skip') {
          skipped++
          continue
        }
      }
      // m-5: item.local は walkLocal の absLocal (ネイティブパス)。Node.js fs API / sftp.fastPut は Windows の \\ も正しく扱う。
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(item.local, item.remote, (err) => (err ? reject(err) : resolve()))
      })
      uploaded++
    }
  }

  return { uploaded, skipped }
}

function shellQuote(p: string): string {
  return "'" + p.replace(/'/g, "'\\''") + "'"
}

/** sec-M-1: POSIX 絶対パスの検証 (null バイト不可) */
function isAbsolutePosixPath(p: string): boolean {
  return /^\/[^\0]*$/.test(p)
}

export async function movePath(handle: string, sources: string[], destDir: string): Promise<void> {
  // sec-M-1: destDir が絶対パス形式であることを検証
  if (!isAbsolutePosixPath(destDir)) throw new Error(`Invalid destination path: ${destDir}`)
  for (const src of sources) {
    const cmd = `mv -- ${shellQuote(src)} ${shellQuote(destDir + '/')}`
    const result = await execCommand(handle, cmd)
    if (result.code !== 0) {
      throw new Error(`mv failed for '${src}' (exit ${result.code}): ${result.stderr.trim()}`)
    }
  }
}

export async function copyPath(handle: string, sources: string[], destDir: string): Promise<void> {
  // sec-M-1: destDir が絶対パス形式であることを検証
  if (!isAbsolutePosixPath(destDir)) throw new Error(`Invalid destination path: ${destDir}`)
  for (const src of sources) {
    const cmd = `cp -r -- ${shellQuote(src)} ${shellQuote(destDir + '/')}`
    const result = await execCommand(handle, cmd)
    if (result.code !== 0) {
      throw new Error(`cp failed for '${src}' (exit ${result.code}): ${result.stderr.trim()}`)
    }
  }
}

// ─── External editor (open in OS default app + fs.watch auto put-back) ────────

interface ExternalWatcher {
  watcherId: string
  handle: string
  tempPath: string
  remotePath: string
  watcher: FSWatcher | null
  pollPath: string | null
  tempDir: string
  /** C-3: closeExternal 時にクリアするための debounce タイマー参照 */
  debounceTimer: ReturnType<typeof setTimeout> | null
}

type PutBackListener = (info: { remotePath: string; ok: boolean; error?: string }) => void
const putBackListeners = new Set<PutBackListener>()
export function onPutBack(cb: PutBackListener): () => void {
  putBackListeners.add(cb)
  return () => putBackListeners.delete(cb)
}

const externalWatchers = new Map<string, ExternalWatcher>()

export async function openExternal(
  handle: string,
  remotePath: string
): Promise<{ tempPath: string; watcherId: string }> {
  const sftp = await getSftp(handle)
  const basename = posixPath.basename(remotePath)
  const randomId = crypto.randomBytes(8).toString('hex')
  const tempDir = nodePath.join(os.tmpdir(), 'ssh-client-edit', handle, randomId)
  mkdirSync(tempDir, { recursive: true })
  const tempPath = nodePath.join(tempDir, basename)

  // Download the remote file to temp
  await new Promise<void>((resolve, reject) => {
    sftp.fastGet(remotePath, tempPath, (err) => (err ? reject(err) : resolve()))
  })

  // Open with default OS app. shell.openPath returns "" on success, error string on failure.
  const openErr = await shell.openPath(tempPath)
  if (openErr) {
    throw new Error(`OS で開けませんでした: ${openErr}`)
  }

  const watcherId = crypto.randomBytes(8).toString('hex')

  // Use both fs.watch (event-based, fast) AND fs.watchFile (poll-based, reliable on Windows)
  // Many editors (Notepad, VS Code) write through temp files which fs.watch may miss.
  let lastSize = -1
  let lastMtime = 0

  // C-3: entry を先に生成して debounceTimer を管理できるようにする
  const entry: ExternalWatcher = { watcherId, handle, tempPath, remotePath, watcher: null, pollPath: tempPath, tempDir, debounceTimer: null }
  externalWatchers.set(watcherId, entry)

  const trigger = () => {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(async () => {
      entry.debounceTimer = null
      try {
        const stat = statSync(tempPath)
        // Skip if size and mtime haven't actually changed (avoids redundant uploads)
        if (stat.size === lastSize && stat.mtimeMs === lastMtime) return
        lastSize = stat.size
        lastMtime = stat.mtimeMs
        const sftp2 = await getSftp(handle)
        await new Promise<void>((resolve, reject) => {
          sftp2.fastPut(tempPath, remotePath, (err) => (err ? reject(err) : resolve()))
        })
        console.log('[external-edit] put-back:', remotePath, `(${stat.size} bytes)`)
        for (const cb of putBackListeners) cb({ remotePath, ok: true })
      } catch (e) {
        const msg = (e as Error).message
        console.error('[external-edit] put-back failed:', msg)
        for (const cb of putBackListeners) cb({ remotePath, ok: false, error: msg })
      }
    }, 600)
  }

  let watcher: FSWatcher | null = null
  try {
    watcher = watch(tempPath, () => trigger())
    entry.watcher = watcher
  } catch {
    // ignore — watchFile below covers it
  }
  // poll every 1s as fallback / primary on Windows
  watchFile(tempPath, { interval: 1000, persistent: true }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) trigger()
  })

  // initialize lastSize/lastMtime so the first save isn't double-uploaded
  try {
    const initial = statSync(tempPath)
    lastSize = initial.size
    lastMtime = initial.mtimeMs
  } catch {
    /* ignore */
  }

  return { tempPath, watcherId }
}

export function closeExternal(watcherId: string): void {
  const entry = externalWatchers.get(watcherId)
  if (!entry) return
  // C-3: pending な debounce タイマーをクリアして closeExternal 後の getSftp 呼び出しを防ぐ
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
    entry.debounceTimer = null
  }
  try {
    entry.watcher?.close()
  } catch {
    /* ignore */
  }
  try {
    if (entry.pollPath) unwatchFile(entry.pollPath)
  } catch {
    /* ignore */
  }
  try {
    rmSync(entry.tempDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  externalWatchers.delete(watcherId)
}

export function closeAllExternalForHandle(handle: string): void {
  for (const [watcherId, entry] of externalWatchers.entries()) {
    if (entry.handle === handle) {
      closeExternal(watcherId)
    }
  }
}
