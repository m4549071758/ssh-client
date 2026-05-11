import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { execCommand } from './SshManager'
import type { ResourceSample } from '../../shared/types'

interface MonitorState {
  samplingId: string
  handle: string
  intervalMs: number
  timer: NodeJS.Timeout | null
  emitter: EventEmitter
  active: boolean
}

const monitors = new Map<string, MonitorState>()

// 1回のSSH呼び出しで全部取得するシェルコマンド (Linux 想定)
const SAMPLE_COMMAND = [
  'echo "L:"; cat /proc/loadavg 2>/dev/null',
  'echo "M:"; (free -k 2>/dev/null | awk \'/^Mem:/ {print $2,$3,$7}\')',
  'echo "D:"; df -k / 2>/dev/null | tail -1 | awk \'{print $2,$3,$5}\'',
  'echo "U:"; cat /proc/uptime 2>/dev/null | awk \'{print $1}\'',
  'echo "C:"; nproc 2>/dev/null'
].join(';')

export function getEmitter(samplingId: string): EventEmitter | undefined {
  return monitors.get(samplingId)?.emitter
}

export function start(handle: string, intervalMs: number): string {
  const samplingId = randomUUID()
  const emitter = new EventEmitter()
  const safeInterval = Math.max(1000, Math.min(60000, intervalMs))

  const state: MonitorState = {
    samplingId,
    handle,
    intervalMs: safeInterval,
    timer: null,
    emitter,
    active: true
  }
  monitors.set(samplingId, state)

  // 即座に1回サンプル、その後は interval ごと
  const runOnce = async (): Promise<void> => {
    if (!state.active) return
    try {
      const result = await execCommand(handle, SAMPLE_COMMAND)
      const sample = parseSample(result.stdout)
      if (state.active) emitter.emit('sample', sample)
    } catch (e) {
      if (state.active) emitter.emit('error', (e as Error).message)
    }
    if (state.active) {
      state.timer = setTimeout(runOnce, state.intervalMs)
    }
  }
  setImmediate(() => {
    void runOnce()
  })

  return samplingId
}

export function stop(samplingId: string): void {
  const m = monitors.get(samplingId)
  if (!m) return
  m.active = false
  if (m.timer) clearTimeout(m.timer)
  monitors.delete(samplingId)
}

/** SSH セッション終了時に紐づくサンプリングを全停止 */
export function stopAllForHandle(handle: string): void {
  for (const m of [...monitors.values()]) {
    if (m.handle === handle) stop(m.samplingId)
  }
}

function parseSample(stdout: string): ResourceSample {
  const sample: ResourceSample = {
    timestamp: Date.now(),
    loadavg: null,
    memory: null,
    disk: null,
    uptimeSeconds: null,
    cpuCount: null
  }

  // セクション分け
  const sections: Record<string, string[]> = {}
  let current = ''
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/^[LMDUC]:$/.test(trimmed)) {
      current = trimmed[0]
      sections[current] = []
    } else if (current && trimmed) {
      sections[current].push(trimmed)
    }
  }

  // L: loadavg "0.10 0.20 0.30 1/123 12345"
  const loadLine = sections['L']?.[0]
  if (loadLine) {
    const parts = loadLine.split(/\s+/)
    const l1 = parseFloat(parts[0])
    const l5 = parseFloat(parts[1])
    const l15 = parseFloat(parts[2])
    if (!isNaN(l1)) sample.loadavg = { '1m': l1, '5m': l5, '15m': l15 }
  }

  // M: "total used available" (kB)
  const memLine = sections['M']?.[0]
  if (memLine) {
    const parts = memLine.split(/\s+/).map((s) => parseInt(s, 10))
    if (parts.length >= 3 && !isNaN(parts[0])) {
      const total = parts[0] * 1024
      const used = parts[1] * 1024
      const available = parts[2] * 1024
      sample.memory = { totalBytes: total, usedBytes: used, availableBytes: available }
    }
  }

  // D: "total used percent%"
  const diskLine = sections['D']?.[0]
  if (diskLine) {
    const parts = diskLine.split(/\s+/)
    const total = parseInt(parts[0], 10)
    const used = parseInt(parts[1], 10)
    const pctStr = parts[2] ?? ''
    const pct = parseInt(pctStr.replace('%', ''), 10)
    if (!isNaN(total) && !isNaN(pct)) {
      sample.disk = {
        totalBytes: total * 1024,
        usedBytes: used * 1024,
        usedPercent: pct
      }
    }
  }

  // U: uptime seconds
  const uptimeLine = sections['U']?.[0]
  if (uptimeLine) {
    const sec = parseFloat(uptimeLine)
    if (!isNaN(sec)) sample.uptimeSeconds = sec
  }

  // C: cpu count
  const cpuLine = sections['C']?.[0]
  if (cpuLine) {
    const n = parseInt(cpuLine, 10)
    if (!isNaN(n)) sample.cpuCount = n
  }

  return sample
}
