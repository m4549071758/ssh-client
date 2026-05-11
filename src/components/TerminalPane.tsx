import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { api, type AppSettings } from '../ipc'

interface Props {
  handle: string
  settings: AppSettings
  onClose: () => void
}

const themes: Record<AppSettings['theme'], any> = {
  dark: {
    background: '#0f1117',
    foreground: '#e5e7ee',
    cursor: '#5b9dff',
    selectionBackground: '#3b4a6b',
    black: '#1f2330',
    red: '#ff6b81',
    green: '#7ee787',
    yellow: '#ffb86b',
    blue: '#5b9dff',
    magenta: '#c792ea',
    cyan: '#56d6c1',
    white: '#e5e7ee',
    brightBlack: '#5c6370',
    brightRed: '#ff8597',
    brightGreen: '#9bf2a3',
    brightYellow: '#ffce8a',
    brightBlue: '#7aafff',
    brightMagenta: '#dab4ff',
    brightCyan: '#7eecdc',
    brightWhite: '#ffffff'
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2330',
    cursor: '#2563eb',
    selectionBackground: '#cfdcf1',
    black: '#1f2330',
    red: '#c4314b',
    green: '#1b8a3a',
    yellow: '#a06800',
    blue: '#2563eb',
    magenta: '#a83fbf',
    cyan: '#0891a3',
    white: '#3a3f4b',
    brightBlack: '#6b7280',
    brightRed: '#e0455f',
    brightGreen: '#28a651',
    brightYellow: '#c08400',
    brightBlue: '#3b82f6',
    brightMagenta: '#c560d8',
    brightCyan: '#10b3c2',
    brightWhite: '#1f2330'
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#93a1a1',
    cursor: '#93a1a1',
    selectionBackground: '#073642'
  }
}

export function TerminalPane({ handle, settings, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: themes.dark
    })

    const fit = new FitAddon()
    const unicode11 = new Unicode11Addon()
    const links = new WebLinksAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(unicode11)
    term.loadAddon(links)
    term.loadAddon(search)
    term.unicode.activeVersion = '11'

    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const offData = api.ssh.onData(handle, (chunk) => term.write(chunk))
    const offClose = api.ssh.onClose(handle, () => {
      term.write('\r\n[connection closed]\r\n')
      onClose()
    })
    const offErr = api.ssh.onError(handle, (msg) => {
      term.write(`\r\n[error] ${msg}\r\n`)
    })
    // A5: 再接続中の通知をターミナルに表示、再接続成功時はバッファ維持のまま継続
    const offReconnecting = api.ssh.onReconnecting(handle, ({ attempt, delayMs }) => {
      term.write(`\r\n[··· 再接続中 (試行 ${attempt}, ${Math.round(delayMs / 1000)}秒後) ···]\r\n`)
    })

    term.onData((data) => api.ssh.write(handle, data))

    // selection auto-copy
    term.onSelectionChange(() => {
      if (!settings.copyOnSelect) return
      const sel = term.getSelection()
      if (sel && sel.length > 0) {
        navigator.clipboard.writeText(sel).catch(() => undefined)
      }
    })

    // resize observer
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        api.ssh.resize(handle, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    })
    ro.observe(containerRef.current)

    return () => {
      try { ro.disconnect() } catch { /* ignore */ }
      try { offData() } catch { /* ignore */ }
      try { offClose() } catch { /* ignore */ }
      try { offErr() } catch { /* ignore */ }
      try { offReconnecting() } catch { /* ignore */ }
      // Defer dispose to next tick so any pending resize/scroll callbacks complete first
      setTimeout(() => {
        try { term.dispose() } catch { /* ignore */ }
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle])

  // live update font/theme when settings change
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.fontFamily = settings.fontFamily
    t.options.fontSize = settings.fontSize
    t.options.lineHeight = settings.lineHeight
    t.options.theme = themes.dark
    fitRef.current?.fit()
  }, [settings])

  async function paste() {
    const t = termRef.current
    if (!t) return
    const text = await navigator.clipboard.readText()
    if (text) t.paste(text)
    setMenu(null)
  }

  function copy() {
    const t = termRef.current
    if (!t) return
    const sel = t.getSelection()
    if (sel) navigator.clipboard.writeText(sel).catch(() => undefined)
    setMenu(null)
  }

  function selectAll() {
    termRef.current?.selectAll()
    setMenu(null)
  }

  function clearScreen() {
    termRef.current?.clear()
    setMenu(null)
  }

  return (
    <div
      className="relative h-full w-full"
      style={{ background: themes.dark.background }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onClick={() => setMenu(null)}
    >
      <div ref={containerRef} className="h-full w-full" />
      {menu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-bg-soft py-1 text-sm shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem onClick={copy}>コピー</MenuItem>
          <MenuItem onClick={paste}>貼り付け</MenuItem>
          <MenuItem onClick={selectAll}>すべて選択</MenuItem>
          <MenuItem onClick={clearScreen}>画面クリア</MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left hover:bg-bg-mute"
    >
      {children}
    </button>
  )
}
