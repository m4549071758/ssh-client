import { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } from 'electron'
import { join, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as Sessions from './store/sessions'
import * as Vault from './store/vault'
import * as Settings from './store/settings'
import * as Ssh from './ssh/SshManager'
import * as Sftp from './ssh/SftpManager'
import * as Transfer from './ssh/TransferManager'
import * as KnownHosts from './store/knownHosts'
import { isHelloAvailable, getBiometricLabel } from './auth'

import type { SessionProfile, VaultEntry, HostKeyDecision } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171a23',
      symbolColor: '#e5e7ee',
      height: 32
    },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,         // H-3: preload は contextBridge + ipcRenderer のみなので移行可能
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  Menu.setApplicationMenu(null)

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // H-1: https? のみ許可し、file:// / smb:// 等の危険スキームを拒否
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  // H-2: will-navigate で外部 URL へのナビゲーションを防止
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL'] ?? `file://${join(__dirname, '../renderer/index.html')}`
    if (!url.startsWith(allowed)) {
      event.preventDefault()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // M-4: F12 / Ctrl+Shift+I での DevTools 起動は開発環境のみ有効
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow?.webContents.toggleDevTools()
      }
    })
  }
}

function registerIpc(): void {
  // sessions
  ipcMain.handle('sessions:list', () => Sessions.listSessions())
  ipcMain.handle('sessions:save', (_e, profile: Omit<SessionProfile, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }) =>
    Sessions.upsertSession(profile)
  )
  ipcMain.handle('sessions:delete', (_e, id: string) => Sessions.deleteSession(id))

  // vault
  ipcMain.handle('vault:status', () => Vault.status())
  ipcMain.handle('vault:setupMaster', (_e, pw: string) => Vault.setupMaster(pw))
  ipcMain.handle('vault:unlockMaster', (_e, pw: string, autoLockMinutes: number) => Vault.unlockMaster(pw, autoLockMinutes))
  ipcMain.handle('vault:changeMaster', (_e, oldPw: string, newPw: string) => Vault.changeMaster(oldPw, newPw))
  ipcMain.handle('vault:enrollHello', () => Vault.enrollHello())
  ipcMain.handle('vault:removeHello', () => Vault.removeHello())
  ipcMain.handle('vault:unlockHello', (_e, autoLockMinutes: number) => Vault.unlockHello(autoLockMinutes))
  ipcMain.handle('vault:lock', () => Vault.lock())
  ipcMain.handle('vault:list', () => Vault.listEntries())
  ipcMain.handle('vault:upsert', (_e, entry: Omit<VaultEntry, 'id'> & { id?: string }) => Vault.upsertEntry(entry))
  ipcMain.handle('vault:delete', (_e, id: string) => Vault.deleteEntry(id))

  // settings
  ipcMain.handle('settings:get', () => Settings.getSettings())
  ipcMain.handle('settings:set', (_e, patch) => Settings.updateSettings(patch))
  ipcMain.handle('settings:applyChrome', (_e, theme: string) => {
    if (!mainWindow) return
    const palette = theme === 'light'
      ? { color: '#f4f5f8', symbolColor: '#1f2330' }
      : theme === 'solarized-dark'
        ? { color: '#073642', symbolColor: '#93a1a1' }
        : { color: '#171a23', symbolColor: '#e5e7ee' }
    try {
      mainWindow.setTitleBarOverlay({ ...palette, height: 32 })
      mainWindow.setBackgroundColor(theme === 'light' ? '#ffffff' : '#0f1117')
    } catch {
      /* ignore on platforms that don't support it */
    }
  })

  // ssh
  ipcMain.handle('ssh:open', (event, sessionId: string, opts: { cols: number; rows: number; password?: string; passphrase?: string }) => {
    const profile = Sessions.getSession(sessionId)
    if (!profile) throw new Error('Session not found')
    const { handle, events } = Ssh.open(profile, {
      cols: opts.cols,
      rows: opts.rows,
      override: { password: opts.password, privateKeyPassphrase: opts.passphrase }
    })

    const wc = event.sender
    events.on('ready', () => wc.send(`ssh:ready:${handle}`))
    events.on('data', (chunk: Buffer) => wc.send(`ssh:data:${handle}`, chunk))
    events.on('close', () => wc.send(`ssh:close:${handle}`))
    events.on('error', (msg: string) => wc.send(`ssh:error:${handle}`, msg))
    events.on('hostKeyPrompt', (info) => wc.send(`ssh:hostKeyPrompt:${handle}`, info))
    events.on('reconnecting', (info: { attempt: number; delayMs: number }) => wc.send(`ssh:reconnecting:${handle}`, info))
    return handle
  })
  ipcMain.handle('ssh:hostKeyResponse', (_e, handle: string, decision: HostKeyDecision) =>
    Ssh.resolveHostKeyPrompt(handle, decision)
  )
  ipcMain.handle('ssh:write', (_e, handle: string, data: string) => Ssh.write(handle, data))
  ipcMain.handle('ssh:resize', (_e, handle: string, cols: number, rows: number) => Ssh.resize(handle, cols, rows))
  ipcMain.handle('ssh:close', (_e, handle: string) => {
    Sftp.closeAllExternalForHandle(handle)
    return Ssh.close(handle)
  })

  // sftp
  ipcMain.handle('sftp:list', (_e, handle: string, path: string) => Sftp.list(handle, path))
  ipcMain.handle('sftp:readFile', (_e, handle: string, path: string) => Sftp.readFile(handle, path))
  ipcMain.handle('sftp:writeFile', (_e, handle: string, path: string, contents: string) => Sftp.writeFile(handle, path, contents))
  ipcMain.handle('sftp:download', async (_e, handle: string, remote: string, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow!
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: defaultName })
    if (canceled || !filePath) return null
    await Sftp.downloadToFile(handle, remote, filePath)
    return filePath
  })
  ipcMain.handle('sftp:upload', async (_e, handle: string, remoteDir: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow!
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
    if (canceled) return []
    const uploaded: string[] = []
    for (const local of filePaths) {
      // M-2: basename を使ってパス末尾を正しく取得
      const name = basename(local)
      if (!name) continue
      const remote = Sftp.joinPath(remoteDir, name)
      await Sftp.uploadFromFile(handle, local, remote)
      uploaded.push(remote)
    }
    return uploaded
  })
  ipcMain.handle('sftp:uploadPaths', async (_e, handle: string, remoteDir: string, paths: string[]) => {
    // H-5: 簡易バリデーション (存在確認 + home ディレクトリ配下チェック)
    // TODO: 厳格なホワイトリスト管理は将来課題
    const uploaded: string[] = []
    for (const local of paths) {
      // M-2: basename を使ってパス末尾を正しく取得
      const name = basename(local)
      if (!name) continue
      // H-5: ファイルの存在確認と home 配下チェック
      if (!existsSync(local)) {
        throw new Error(`Upload path does not exist: ${local}`)
      }
      const homePath = app.getPath('home')
      if (!local.startsWith(homePath)) {
        throw new Error(`Upload path is outside home directory: ${local}`)
      }
      const remote = Sftp.joinPath(remoteDir, name)
      await Sftp.uploadFromFile(handle, local, remote)
      uploaded.push(remote)
    }
    return uploaded
  })
  ipcMain.handle('sftp:rename', (_e, handle: string, oldPath: string, newPath: string) => Sftp.rename(handle, oldPath, newPath))
  ipcMain.handle('sftp:remove', (_e, handle: string, path: string, isDir: boolean) => Sftp.remove(handle, path, isDir))
  ipcMain.handle('sftp:mkdir', (_e, handle: string, path: string) => Sftp.mkdir(handle, path))
  ipcMain.handle('sftp:planUpload', (_e, handle: string, items: { localPath: string; remoteDir: string }[]) =>
    Sftp.planUpload(handle, items)
  )
  ipcMain.handle(
    'sftp:executeUpload',
    (_e, handle: string, uploads: { local: string; remote: string; isDir: boolean }[], conflictAction: 'overwrite' | 'skip' | 'per-file', perFileActions?: Record<string, 'overwrite' | 'skip'>) =>
      Sftp.executeUpload(handle, uploads, conflictAction, perFileActions)
  )
  ipcMain.handle('sftp:removeRecursive', (_e, handle: string, path: string) => Sftp.removeRecursive(handle, path))
  ipcMain.handle('sftp:movePath', (_e, handle: string, sources: string[], destDir: string) => Sftp.movePath(handle, sources, destDir))
  ipcMain.handle('sftp:copyPath', (_e, handle: string, sources: string[], destDir: string) => Sftp.copyPath(handle, sources, destDir))
  // M-3: sftp:downloadFolder は fastGet (ファイル専用) を使っているためディレクトリでは失敗する。
  // 再帰ダウンロード実装は将来課題。現状は UI でフォルダへのダウンロードを制限している。
  ipcMain.handle('sftp:downloadFolder', async (_e, handle: string, remote: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow!
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (canceled || !filePaths[0]) return null
    // n-1: require('node:path') を import した join / basename に変更
    await Sftp.downloadToFile(handle, remote, join(filePaths[0], basename(remote)))
    return filePaths[0]
  })
  ipcMain.handle('sftp:downloadMultiple', async (_e, handle: string, remotes: string[]) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow!
    if (remotes.length === 1) {
      const name = remotes[0].split('/').pop() ?? 'file'
      const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: name })
      if (canceled || !filePath) return null
      await Sftp.downloadToFile(handle, remotes[0], filePath)
      return filePath
    }
    // multiple: pick folder
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (canceled || !filePaths[0]) return null
    const destDir = filePaths[0]
    // n-1: require('node:path') を import した join に変更
    for (const remote of remotes) {
      const name = remote.split('/').pop() ?? 'file'
      await Sftp.downloadToFile(handle, remote, join(destDir, name))
    }
    return destDir
  })
  ipcMain.handle('sftp:openExternal', (_e, handle: string, remotePath: string) =>
    Sftp.openExternal(handle, remotePath)
  )
  ipcMain.handle('sftp:closeExternal', (_e, watcherId: string) => Sftp.closeExternal(watcherId))

  // transfer: 並列ファイル転送 API
  ipcMain.handle(
    'transfer:startUpload',
    (event, handle: string, items: { local: string; remote: string; isDir: boolean }[]) => {
      return Transfer.startUpload(handle, items).then((transferId) => {
        const wc = event.sender
        const emitter = Transfer.getEmitter(transferId)
        if (emitter) {
          emitter.on('progress', (p) => wc.send(`transfer:progress:${transferId}`, p))
          emitter.on('complete', (c) => wc.send(`transfer:complete:${transferId}`, c))
          emitter.on('error', (msg: string) => wc.send(`transfer:error:${transferId}`, msg))
        }
        return transferId
      })
    }
  )
  ipcMain.handle(
    'transfer:startDownload',
    (event, handle: string, items: { remote: string; local: string; size?: number }[]) => {
      return Transfer.startDownload(handle, items).then((transferId) => {
        const wc = event.sender
        const emitter = Transfer.getEmitter(transferId)
        if (emitter) {
          emitter.on('progress', (p) => wc.send(`transfer:progress:${transferId}`, p))
          emitter.on('complete', (c) => wc.send(`transfer:complete:${transferId}`, c))
          emitter.on('error', (msg: string) => wc.send(`transfer:error:${transferId}`, msg))
        }
        return transferId
      })
    }
  )
  ipcMain.handle('transfer:cancel', (_e, transferId: string) => Transfer.cancel(transferId))

  // dialogs
  ipcMain.handle('dialog:openFiles', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow!
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections']
    })
    if (canceled) return []
    return filePaths
  })
  ipcMain.handle('dialog:openPrivateKey', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow!
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Private keys', extensions: ['pem', 'ppk', 'key', 'rsa', 'ed25519', 'dsa', 'ecdsa'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  ipcMain.handle('hello:available', () => isHelloAvailable())
  ipcMain.handle('hello:label', () => getBiometricLabel())

  // known_hosts
  ipcMain.handle('knownHosts:list', () => KnownHosts.list())
  ipcMain.handle('knownHosts:remove', (_e, host: string) => KnownHosts.remove(host))
  ipcMain.handle('knownHosts:clear', () => KnownHosts.clear())
}

app.whenReady().then(() => {
  // sec-M-2: CSP ヘッダーを設定 (Monaco Editor + xterm のため unsafe-eval / blob: / unsafe-inline を許容)
  // 元のレスポンスヘッダ (Content-Type 等) を保持しつつ CSP を追加。dev 時は HMR を阻害しないよう skip。
  if (!process.env['ELECTRON_RENDERER_URL']) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:"
          ]
        }
      })
    })
  }

  registerIpc()
  Sftp.onPutBack((info) => {
    if (mainWindow) mainWindow.webContents.send('sftp:putback', info)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
