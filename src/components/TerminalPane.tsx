import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react'
import { api, type AppSettings } from '../ipc'

interface Props {
  handle: string
  settings: AppSettings
  onClose: () => void
}

const themes: Record<AppSettings['theme'], Record<string, string>> = {
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

const searchDecorations: ISearchOptions['decorations'] = {
  matchBackground: '#facc15',
  matchBorder: '#eab308',
  matchOverviewRuler: '#facc15',
  activeMatchBackground: '#fb923c',
  activeMatchBorder: '#f97316',
  activeMatchColorOverviewRuler: '#fb923c'
}

export function TerminalPane({ handle, settings, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<{ resultIndex: number; resultCount: number } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const themeKey = settings.theme
  const activeTheme = themes[themeKey] ?? themes.dark

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: activeTheme
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

    // C6: 検索結果カウントを購読
    search.onDidChangeResults((evt) => {
      setSearchResult(evt ? { resultIndex: evt.resultIndex, resultCount: evt.resultCount } : null)
    })

    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    const offData = api.ssh.onData(handle, (chunk) => term.write(chunk))
    const offClose = api.ssh.onClose(handle, () => {
      term.write('\r\n[connection closed]\r\n')
      onClose()
    })
    const offErr = api.ssh.onError(handle, (msg) => {
      term.write(`\r\n[error] ${msg}\r\n`)
    })
    const offReconnecting = api.ssh.onReconnecting(handle, ({ attempt, delayMs }) => {
      term.write(`\r\n[··· 再接続中 (試行 ${attempt}, ${Math.round(delayMs / 1000)}秒後) ···]\r\n`)
    })

    term.onData((data) => api.ssh.write(handle, data))

    term.onSelectionChange(() => {
      if (!settings.copyOnSelect) return
      const sel = term.getSelection()
      if (sel && sel.length > 0) {
        navigator.clipboard.writeText(sel).catch(() => undefined)
      }
    })

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
      setTimeout(() => {
        try { term.dispose() } catch { /* ignore */ }
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle])

  // settings 変更時のライブ更新 (テーマ含む)
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.fontFamily = settings.fontFamily
    t.options.fontSize = settings.fontSize
    t.options.lineHeight = settings.lineHeight
    t.options.theme = activeTheme
    fitRef.current?.fit()
  }, [settings, activeTheme])

  // C6: Ctrl/Cmd+F で検索バー開閉
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        // ターミナルにフォーカスがある時のみ反応
        const t = termRef.current
        if (!t) return
        if (containerRef.current?.contains(document.activeElement) || document.activeElement === document.body) {
          e.preventDefault()
          setSearchOpen(true)
          setTimeout(() => searchInputRef.current?.focus(), 0)
        }
      } else if (e.key === 'Escape' && searchOpen) {
        closeSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [searchOpen])

  function findNext(): void {
    const s = searchRef.current
    if (!s || !searchQuery) return
    s.findNext(searchQuery, { decorations: searchDecorations })
  }

  function findPrevious(): void {
    const s = searchRef.current
    if (!s || !searchQuery) return
    s.findPrevious(searchQuery, { decorations: searchDecorations })
  }

  function closeSearch(): void {
    setSearchOpen(false)
    searchRef.current?.clearDecorations()
    setSearchResult(null)
  }

  // 入力変更で即座に検索
  useEffect(() => {
    const s = searchRef.current
    if (!s) return
    if (!searchQuery) {
      s.clearDecorations()
      setSearchResult(null)
      return
    }
    s.findNext(searchQuery, { decorations: searchDecorations })
  }, [searchQuery])

  async function paste(): Promise<void> {
    const t = termRef.current
    if (!t) return
    const text = await navigator.clipboard.readText()
    if (text) t.paste(text)
    setMenu(null)
  }

  function copy(): void {
    const t = termRef.current
    if (!t) return
    const sel = t.getSelection()
    if (sel) navigator.clipboard.writeText(sel).catch(() => undefined)
    setMenu(null)
  }

  function selectAll(): void {
    termRef.current?.selectAll()
    setMenu(null)
  }

  function clearScreen(): void {
    termRef.current?.clear()
    setMenu(null)
  }

  function openSearchFromMenu(): void {
    setSearchOpen(true)
    setMenu(null)
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  function sendSnippet(content: string, appendNewline: boolean): void {
    api.ssh.write(handle, content + (appendNewline ? '\n' : ''))
    setMenu(null)
  }

  return (
    <div
      className="relative h-full w-full"
      style={{ background: activeTheme.background }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onClick={() => setMenu(null)}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* C6: 検索バー */}
      {searchOpen && (
        <div className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-md border border-border bg-bg-soft px-2 py-1 shadow-xl">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) findPrevious()
                else findNext()
              } else if (e.key === 'Escape') {
                closeSearch()
              }
            }}
            placeholder="検索"
            className="w-44 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg outline-none focus:border-accent"
          />
          <span className="min-w-[40px] text-center text-[10px] text-fg-mute tabular-nums">
            {searchResult
              ? searchResult.resultCount === 0
                ? '0/0'
                : `${searchResult.resultIndex + 1}/${searchResult.resultCount}`
              : ''}
          </span>
          <button onClick={findPrevious} title="前へ (Shift+Enter)" className="rounded p-0.5 text-fg-mute hover:bg-bg-mute hover:text-fg">
            <ChevronUp size={12} />
          </button>
          <button onClick={findNext} title="次へ (Enter)" className="rounded p-0.5 text-fg-mute hover:bg-bg-mute hover:text-fg">
            <ChevronDown size={12} />
          </button>
          <button onClick={closeSearch} title="閉じる (Esc)" className="rounded p-0.5 text-fg-mute hover:bg-bg-mute hover:text-fg">
            <X size={12} />
          </button>
        </div>
      )}

      {menu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-bg-soft py-1 text-sm shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem onClick={copy}>コピー</MenuItem>
          <MenuItem onClick={paste}>貼り付け</MenuItem>
          <MenuItem onClick={selectAll}>すべて選択</MenuItem>
          <MenuItem onClick={openSearchFromMenu}>検索 (Ctrl+F)</MenuItem>
          <MenuItem onClick={clearScreen}>画面クリア</MenuItem>
          {settings.snippets && settings.snippets.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <div className="relative">
                <div className="group/snippets">
                  <div className="flex w-full items-center justify-between px-3 py-1.5 text-fg-mute hover:bg-bg-mute">
                    <span>スニペット</span>
                    <ChevronRight size={12} />
                  </div>
                  <div className="absolute left-full top-0 hidden min-w-[200px] rounded-md border border-border bg-bg-soft py-1 shadow-xl group-hover/snippets:block">
                    {settings.snippets.map((sn) => (
                      <MenuItem key={sn.id} onClick={() => sendSnippet(sn.content, sn.appendNewline)}>
                        <span className="block truncate">{sn.label}</span>
                      </MenuItem>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left hover:bg-bg-mute"
    >
      {children}
    </button>
  )
}
