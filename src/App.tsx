import { useEffect, useState } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { useApp } from './stores/app'
import { api } from './ipc'
import type { SessionProfile } from './ipc'
import { cn } from './components/ui'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { SftpPane } from './components/SftpPane'
import { VaultDialog } from './components/VaultDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SessionEditor } from './components/SessionEditor'
import { AuthPrompt } from './components/AuthPrompt'

export default function App() {
  const {
    sessions, vault, settings, tabs, activeTabId,
    loadSessions, loadVault, loadSettings, updateSettings,
    saveSession, deleteSession,
    openTab, setTabHandle, setTabStatus, closeTab, setActive
  } = useApp()

  const [vaultOpen, setVaultOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<SessionProfile | null>(null)
  const [pendingConnect, setPendingConnect] = useState<SessionProfile | null>(null)

  // Auth prompt state
  const [authPrompt, setAuthPrompt] = useState<{
    session: SessionProfile
    type: 'password' | 'passphrase'
  } | null>(null)

  useEffect(() => {
    loadSessions()
    loadVault()
    loadSettings()
    // Prevent default drag behavior at window level so SFTP pane can receive drops
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      console.log('[doc] dragenter target=', (e.target as HTMLElement)?.tagName, (e.target as HTMLElement)?.className)
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      console.log('[doc] drop on', (e.target as HTMLElement)?.tagName, 'files=', e.dataTransfer?.files?.length)
    }
    document.addEventListener('dragenter', onDragEnter, true)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [])

  useEffect(() => {
    const theme = settings?.theme ?? 'light'
    document.documentElement.classList.toggle('light', theme === 'light')
    document.documentElement.classList.toggle('dark', theme !== 'light')
    // ask main to update window title bar overlay color
    ;(window as any).api?.settings?.applyChrome?.(theme).catch?.(() => undefined)
  }, [settings?.theme])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  async function doConnect(session: SessionProfile, password?: string, passphrase?: string) {
    const tabId = openTab(session.id)
    try {
      const handle = await api.ssh.open(session.id, { cols: 80, rows: 24, password, passphrase })
      setTabHandle(tabId, handle)

      const offReady = api.ssh.onReady(handle, () => {
        setTabStatus(tabId, 'ready')
        offReady()
      })
      // M-4: onError / onClose のリスナーは close 時に解除してリークを防ぐ
      const offErr = api.ssh.onError(handle, (msg) => {
        setTabStatus(tabId, 'error', msg)
      })
      const offClose = api.ssh.onClose(handle, () => {
        setTabStatus(tabId, 'closed')
        offErr()
        offClose()
      })
    } catch (e) {
      setTabStatus(tabId, 'error', (e as Error).message)
    }
  }

  function handleConnect(session: SessionProfile) {
    if (session.authType === 'password' && !session.credentialId) {
      setAuthPrompt({ session, type: 'password' })
      return
    }
    if (session.authType === 'privateKey' && !session.credentialId) {
      setAuthPrompt({ session, type: 'passphrase' })
      return
    }
    // credentialRef or credential stored in vault
    if (session.credentialId && !vault.status?.isUnlocked) {
      setPendingConnect(session)
      setVaultOpen(true)
      return
    }
    doConnect(session)
  }

  // When vault becomes unlocked, auto-resume any pending connect and close the dialog
  useEffect(() => {
    if (vault.status?.isUnlocked && pendingConnect) {
      const s = pendingConnect
      setPendingConnect(null)
      setVaultOpen(false)
      doConnect(s)
    }
  }, [vault.status?.isUnlocked, pendingConnect])

  function handleAuthSubmit(value: string) {
    if (!authPrompt) return
    const { session, type } = authPrompt
    setAuthPrompt(null)
    if (type === 'password') {
      doConnect(session, value, undefined)
    } else {
      doConnect(session, undefined, value || undefined)
    }
  }

  function handleAuthCancel() {
    if (!authPrompt) return
    const { session, type } = authPrompt
    setAuthPrompt(null)
    // For passphrase, allow connecting without passphrase
    if (type === 'passphrase') {
      doConnect(session, undefined, undefined)
    }
  }

  const defaultSettings = settings ?? {
    fontFamily: "'Cascadia Code', 'Yu Gothic Mono', 'MS Gothic', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    theme: 'dark' as const,
    copyOnSelect: true,
    bracketedPaste: true,
    autoLockMinutes: 15
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <div
        className="h-8 shrink-0 bg-bg-soft"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex flex-1 overflow-hidden">
      <PanelGroup direction="horizontal" autoSaveId="ssh-client:outer-layout" className="flex-1">
        <Panel defaultSize={16} minSize={10} maxSize={35}>
          <Sidebar
            sessions={sessions}
            vaultStatus={vault.status}
            onNewSession={() => { setEditingSession(null); setEditorOpen(true) }}
            onEditSession={(s) => { setEditingSession(s); setEditorOpen(true) }}
            onDeleteSession={(s) => deleteSession(s.id)}
            onConnect={handleConnect}
            onOpenVault={() => setVaultOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </Panel>
        <PanelResizeHandle className="w-1 bg-border hover:bg-accent transition-colors" />
        <Panel defaultSize={84} minSize={40}>
          <div className="flex h-full flex-col overflow-hidden">
        {tabs.length > 0 && (
          <TabBar
            tabs={tabs}
            activeId={activeTabId}
            onSelect={setActive}
            onClose={closeTab}
          />
        )}

        {tabs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-fg-mute text-sm">
            セッションを選択して接続してください
          </div>
        ) : activeTab ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            {activeTab.status === 'error' && activeTab.errorMessage && (
              <div className={cn('shrink-0 bg-rose-900/40 px-4 py-2 text-xs text-rose-300')}>
                エラー: {activeTab.errorMessage}
              </div>
            )}
            {activeTab.handle && activeTab.status === 'ready' ? (
              <PanelGroup direction="horizontal" autoSaveId="ssh-client:terminal-sftp" className="flex-1">
                <Panel defaultSize={60} minSize={20}>
                  <TerminalPane
                    handle={activeTab.handle}
                    settings={defaultSettings}
                    onClose={() => closeTab(activeTab.id)}
                  />
                </Panel>
                <PanelResizeHandle className="w-1 bg-border hover:bg-accent transition-colors" />
                <Panel defaultSize={40} minSize={15}>
                  <SftpPane
                    handle={activeTab.handle}
                    theme={defaultSettings.theme === 'light' ? 'vs' : 'vs-dark'}
                  />
                </Panel>
              </PanelGroup>
            ) : (
              <div className="flex flex-1 items-center justify-center text-fg-mute text-sm">
                {activeTab.status === 'connecting' && '接続中…'}
                {activeTab.status === 'closed' && '接続が閉じられました'}
                {activeTab.status === 'error' && 'エラーが発生しました'}
              </div>
            )}
          </div>
        ) : null}
          </div>
        </Panel>
      </PanelGroup>

      {/* Modals */}
      {vault.status && (
        <VaultDialog
          open={vaultOpen}
          onOpenChange={setVaultOpen}
          status={vault.status}
          entries={vault.entries}
          onChanged={loadVault}
        />
      )}

      {settings && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSave={updateSettings}
        />
      )}

      <SessionEditor
        open={editorOpen}
        initial={editingSession}
        vaultUnlocked={vault.status?.isUnlocked ?? false}
        vaultEntries={vault.entries}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); loadSessions() }}
      />

      <AuthPrompt
        open={!!authPrompt}
        title={authPrompt?.type === 'password' ? 'パスワード入力' : 'パスフレーズ入力'}
        label={authPrompt?.type === 'password' ? 'パスワード' : 'パスフレーズ (空欄でスキップ)'}
        onSubmit={handleAuthSubmit}
        onCancel={handleAuthCancel}
      />
      </div>
    </div>
  )
}
