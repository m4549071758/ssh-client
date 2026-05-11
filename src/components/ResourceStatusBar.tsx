import { useEffect, useState } from 'react'
import { Activity, EyeOff } from 'lucide-react'
import { api, type ResourceSample } from '../ipc'

interface Props {
  handle: string
  intervalMs?: number
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} G`
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** ペイン下部に表示するリモートリソースのステータスバー。 */
export function ResourceStatusBar({ handle, intervalMs = 5000 }: Props): JSX.Element | null {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('ssh-client:monitor:enabled') !== '0' } catch { return true }
  })
  const [sample, setSample] = useState<ResourceSample | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let samplingId: string | null = null
    let offSample: (() => void) | null = null
    let offError: (() => void) | null = null

    api.monitor.start(handle, intervalMs).then((id) => {
      if (stopped) {
        api.monitor.stop(id).catch(() => undefined)
        return
      }
      samplingId = id
      offSample = api.monitor.onSample(id, (s) => setSample(s))
      offError = api.monitor.onError(id, (msg) => setError(msg))
    }).catch((e) => setError((e as Error).message))

    return () => {
      stopped = true
      offSample?.()
      offError?.()
      if (samplingId) {
        api.monitor.stop(samplingId).catch(() => undefined)
      }
    }
  }, [handle, intervalMs, enabled])

  function toggle(): void {
    const next = !enabled
    setEnabled(next)
    try { localStorage.setItem('ssh-client:monitor:enabled', next ? '1' : '0') } catch { /* ignore */ }
  }

  if (!enabled) {
    return (
      <div className="flex shrink-0 items-center justify-end border-t border-border bg-bg-soft px-2 py-0.5 text-[10px] text-fg-mute">
        <button onClick={toggle} className="flex items-center gap-1 rounded px-1 hover:bg-bg-mute" title="リソース監視を開始">
          <Activity size={10} /> モニタ
        </button>
      </div>
    )
  }

  if (!sample) {
    return (
      <div className="flex shrink-0 items-center justify-between border-t border-border bg-bg-soft px-2 py-0.5 text-[10px] text-fg-mute">
        <span>{error ?? 'サンプル取得中…'}</span>
        <button onClick={toggle} className="rounded p-0.5 hover:bg-bg-mute" title="非表示">
          <EyeOff size={10} />
        </button>
      </div>
    )
  }

  const load = sample.loadavg
  const mem = sample.memory
  const disk = sample.disk
  const memPct = mem && mem.totalBytes > 0
    ? Math.round((mem.usedBytes / mem.totalBytes) * 100)
    : null
  const loadPctOfCpu = load && sample.cpuCount
    ? Math.min(999, Math.round((load['1m'] / sample.cpuCount) * 100))
    : null

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-bg-soft px-2 py-0.5 text-[10px] tabular-nums text-fg-mute">
      {load && (
        <span title="Load average (1m / 5m / 15m)">
          <span className="text-fg-mute">load</span>{' '}
          <span className={loadPctOfCpu !== null && loadPctOfCpu > 100 ? 'text-rose-400' : 'text-fg'}>
            {load['1m'].toFixed(2)}
          </span>
          <span className="text-fg-mute"> / {load['5m'].toFixed(2)} / {load['15m'].toFixed(2)}</span>
          {sample.cpuCount && <span className="text-fg-mute"> ({sample.cpuCount}c)</span>}
        </span>
      )}
      {mem && (
        <span title="Memory used / total">
          <span className="text-fg-mute">mem</span>{' '}
          <span className={memPct !== null && memPct >= 90 ? 'text-rose-400' : 'text-fg'}>
            {humanBytes(mem.usedBytes)}
          </span>
          <span className="text-fg-mute">/{humanBytes(mem.totalBytes)} ({memPct}%)</span>
        </span>
      )}
      {disk && (
        <span title="Root filesystem used">
          <span className="text-fg-mute">/</span>{' '}
          <span className={disk.usedPercent >= 90 ? 'text-rose-400' : 'text-fg'}>
            {disk.usedPercent}%
          </span>
          <span className="text-fg-mute"> ({humanBytes(disk.usedBytes)}/{humanBytes(disk.totalBytes)})</span>
        </span>
      )}
      {sample.uptimeSeconds !== null && (
        <span title="Uptime"><span className="text-fg-mute">up</span> {formatUptime(sample.uptimeSeconds)}</span>
      )}
      <button onClick={toggle} className="ml-auto rounded p-0.5 hover:bg-bg-mute" title="非表示">
        <EyeOff size={10} />
      </button>
    </div>
  )
}
