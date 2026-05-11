import { useEffect, useState } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { useApp, findPane } from './stores/app'
import { api } from './ipc'
import { DEFAULT_SETTINGS } from './ipc'
import type { SessionProfile } from './ipc'
import { cn } from './components/ui'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { VaultDialog } from './components/VaultDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SessionEditor } from './components/SessionEditor'
import { AuthPrompt } from './components/AuthPrompt'
import { HostKeyPrompt } from './components/HostKeyPrompt'
import { PaneRenderer } from './components/PaneRenderer'
import { SessionPickerModal } from './components/SessionPickerModal'
import type { HostKeyPromptInfo } from './ipc'

export default function App() {
  const {
    sessions, vault, settings, tabs, activeTabId,
    loadSessions, loadVault, loadSettings, updateSettings,
    saveSession, deleteSession,
    openTab, setPaneHandle, setPaneStatus, setActivePane, splitPane, closePane, closeTab, setActive
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
    paneId?: string
    tabId?: string
  } | null>(null)

  // Host key prompt state
  const [hostKeyPrompt, setHostKeyPrompt] = useState<{
    handle: string
    info: HostKeyPromptInfo
  } | null>(null)

  // Split pending state: 分割ボタン押下でセッション選択モーダルを表示するまで保持
  const [pendingSplit, setPendingSplit] = useState<{
    tabId: string
    paneId: string
    direction: 'horizontal' | 'vertical'
  } | null>(null)

  useEffect(() => {
    loadSessions()
    loadVault()
    loadSettings()
    // Prevent default drag behavior at window level so SFTP pane can receive drops
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
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
    ;(window as unknown as { api?: { settings?: { applyChrome?: (t: string) => Promise<void> } } })
      .api?.settings?.applyChrome?.(theme).catch?.(() => undefined)
  }, [settings?.theme])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  /**
   * SSH接続を開始し、ペインの状態を更新する。
   * paneId が渡された場合は既存ペインに接続、なければ新規タブ作成。
   */
  async function doConnect(
    session: SessionProfile,
    password?: string,
    passphrase?: string,
    targetTabId?: string,
    targetPaneId?: string,
  ) {
    let tabId: string
    let paneId: string

    if (targetTabId && targetPaneId) {
      tabId = targetTabId
      paneId = targetPaneId
      setPaneStatus(tabId, paneId, 'connecting')
    } else {
      const result = openTab(session.id)
      tabId = result.tabId
      paneId = result.paneId
    }

    try {
      const handle = await api.ssh.open(session.id, { cols: 80, rows: 24, password, passphrase })
      setPaneHandle(tabId, paneId, handle)

      const offHostKey = api.ssh.onHostKeyPrompt(handle, (info) => {
        setHostKeyPrompt({ handle, info })
      })

      const offReady = api.ssh.onReady(handle, () => {
        setPaneStatus(tabId, paneId, 'ready')
      })
      const offReconnecting = api.ssh.onReconnecting(handle, () => {
        setPaneStatus(tabId, paneId, 'reconnecting')
      })
      const offErr = api.ssh.onError(handle, (msg) => {
        const currentPane = (() => {
          const t = useApp.getState().tabs.find((tb) => tb.id === tabId)
          if (!t) return undefined
          return findPane(t.layout, paneId)
        })()
        if (currentPane?.status !== 'reconnecting') {
          setPaneStatus(tabId, paneId, 'error', msg)
        }
        offHostKey()
      })
      const offClose = api.ssh.onClose(handle, () => {
        setPaneStatus(tabId, paneId, 'closed')
        offReady()
        offReconnecting()
        offErr()
        offClose()
        offHostKey()
      })
    } catch (e) {
      setPaneStatus(tabId, paneId, 'error', (e as Error).message)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.status?.isUnlocked, pendingConnect])

  function handleAuthSubmit(value: string) {
    if (!authPrompt) return
    const { session, type, tabId, paneId } = authPrompt
    setAuthPrompt(null)
    if (type === 'password') {
      doConnect(session, value, undefined, tabId, paneId)
    } else {
      doConnect(session, undefined, value || undefined, tabId, paneId)
    }
  }

  function handleAuthCancel() {
    if (!authPrompt) return
    const { session, type, tabId, paneId } = authPrompt
    setAuthPrompt(null)
    if (type === 'passphrase') {
      doConnect(session, undefined, undefined, tabId, paneId)
    }
  }

  /** 分割ボタン押下 → セッション選択モーダルを開く */
  function handleSplit(tabId: string, paneId: string, direction: 'horizontal' | 'vertical') {
    setPendingSplit({ tabId, paneId, direction })
  }

  /** セッション選択後に splitPane してから接続 */
  function handleSplitSessionSelect(session: SessionProfile) {
    if (!pendingSplit) return
    const { tabId, paneId, direction } = pendingSplit
    setPendingSplit(null)

    if (session.authType === 'password' && !session.credentialId) {
      // ストアを先に split して paneId を確定させてから auth prompt
      const { newPaneId } = splitPane(tabId, paneId, direction, session.id)
      setAuthPrompt({ session, type: 'password', tabId, paneId: newPaneId })
      return
    }
    if (session.authType === 'privateKey' && !session.credentialId) {
      const { newPaneId } = splitPane(tabId, paneId, direction, session.id)
      setAuthPrompt({ session, type: 'passphrase', tabId, paneId: newPaneId })
      return
    }
    if (session.credentialId && !vault.status?.isUnlocked) {
      // vault unlock 後に接続する pendingConnect ルートへ乗り換えるが、
      // split は即座に実行しておく
      const { newPaneId } = splitPane(tabId, paneId, direction, session.id)
      // ここでは authPrompt ではなく vault unlock を促す
      // unlock 後の doConnect でペイン指定できるよう一時保管
      setPendingConnect(session)
      // paneId を残すため authPrompt を流用
      setAuthPrompt({ session, type: 'password', tabId, paneId: newPaneId })
      setVaultOpen(true)
      return
    }

    const { newPaneId } = splitPane(tabId, paneId, direction, session.id)
    doConnect(session, undefined, undefined, tabId, newPaneId)
  }

  const defaultSettings = settings ?? DEFAULT_SETTINGS

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
                <div className={cn('flex flex-1 overflow-hidden')}>
                  <PaneRenderer
                    node={activeTab.layout}
                    tabId={activeTab.id}
                    activePaneId={activeTab.activePaneId}
                    settings={defaultSettings}
                    onSplit={(paneId, direction) => handleSplit(activeTab.id, paneId, direction)}
                    onClose={(paneId) => closePane(activeTab.id, paneId)}
                    onFocus={(paneId) => setActivePane(activeTab.id, paneId)}
                  />
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

        <HostKeyPrompt
          open={!!hostKeyPrompt}
          info={hostKeyPrompt?.info ?? null}
          onDecision={(decision) => {
            if (hostKeyPrompt) {
              api.ssh.hostKeyResponse(hostKeyPrompt.handle, decision)
              setHostKeyPrompt(null)
            }
          }}
        />

        <SessionPickerModal
          open={!!pendingSplit}
          sessions={sessions}
          onSelect={handleSplitSessionSelect}
          onCancel={() => setPendingSplit(null)}
        />
      </div>
    </div>
  )
}
