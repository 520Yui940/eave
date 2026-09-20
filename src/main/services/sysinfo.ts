import os from 'node:os'
import type { SystemState } from '../../shared/types'
import { getWinApi } from './winapi'
import type { NetRate } from './bridge'

interface CpuSample {
  idle: number
  total: number
}

function readCpuSample(): CpuSample {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const times = cpu.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

function emptyState(): SystemState {
  return {
    cpu: 0,
    gpu: -1,
    memUsedBytes: 0,
    memTotalBytes: os.totalmem(),
    netDownBps: 0,
    netUpBps: 0,
    battery: { hasBattery: false, percent: -1, charging: false },
    uptimeSeconds: Math.round(os.uptime())
  }
}

export class SysinfoService {
  private previous: CpuSample = readCpuSample()
  private timer: NodeJS.Timeout | null = null
  private latest: SystemState = emptyState()
  private netRate: NetRate = { downBps: 0, upBps: 0 }
  /** GPU 占用由游戏模式的短进程采样喂进来；-1 = 没在采样 */
  private gpu = -1

  get state(): SystemState {
    return this.latest
  }

  setNetRate(rate: NetRate): void {
    this.netRate = rate
  }

  setGpu(value: number): void {
    this.gpu = value
  }

  start(onUpdate: (state: SystemState) => void, intervalMs = 1000): void {
    if (this.timer) return
    onUpdate(this.collect())
    this.timer = setInterval(() => onUpdate(this.collect()), intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  collect(): SystemState {
    const winapi = getWinApi()
    const currentSample = readCpuSample()
    const idleDelta = currentSample.idle - this.previous.idle
    const totalDelta = currentSample.total - this.previous.total
    this.previous = currentSample

    const cpu =
      totalDelta > 0
        ? Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)))
        : this.latest.cpu

    const totalMem = os.totalmem()

    this.latest = {
      cpu,
      gpu: this.gpu,
      memUsedBytes: totalMem - os.freemem(),
      memTotalBytes: totalMem,
      netDownBps: this.netRate.downBps,
      netUpBps: this.netRate.upBps,
      battery: winapi.readBattery(),
      uptimeSeconds: Math.round(os.uptime())
    }

    return this.latest
  }
}
