import koffi from 'koffi'
import type { BatteryState } from '../../shared/types'

export type MediaKeyAction = 'playpause' | 'next' | 'previous' | 'stop'
export type VolumeKeyAction = 'volumeUp' | 'volumeDown' | 'volumeMute'

const VK_TABLE: Record<string, number> = {
  next: 0xb0,
  previous: 0xb1,
  stop: 0xb2,
  playpause: 0xb3,
  volumeMute: 0xad,
  volumeDown: 0xae,
  volumeUp: 0xaf
}

const KEYEVENTF_EXTENDEDKEY = 0x0001
const KEYEVENTF_KEYUP = 0x0002

koffi.struct('SYSTEM_POWER_STATUS', {
  ACLineStatus: 'uint8_t',
  BatteryFlag: 'uint8_t',
  BatteryLifePercent: 'uint8_t',
  SystemStatusFlag: 'uint8_t',
  BatteryLifeTime: 'uint32_t',
  BatteryFullLifeTime: 'uint32_t'
})

koffi.struct('RECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long'
})

type KeybdEventFn = (vk: number, scan: number, flags: number, extra: number) => void
type PowerStatusFn = (out: Record<string, number>) => boolean
type ForegroundFn = () => number | bigint
type WindowRectFn = (hwnd: number | bigint, out: Record<string, number>) => boolean
type WindowPidFn = (hwnd: number | bigint, out: { pid: number }) => number

class WinApiLayer {
  private keybdEvent: KeybdEventFn | null = null
  private powerStatus: PowerStatusFn | null = null
  private getForeground: ForegroundFn | null = null
  private getWindowRect: WindowRectFn | null = null
  private getWindowPid: WindowPidFn | null = null
  private readonly diagnostics: string[] = []

  constructor() {
    this.initInput()
    this.initPower()
    this.initDisplay()
  }

  get issues(): string[] {
    return [...this.diagnostics]
  }

  get canSendKeys(): boolean {
    return this.keybdEvent !== null
  }

  get canReadPower(): boolean {
    return this.powerStatus !== null
  }

  private initInput(): void {
    try {
      const user32 = koffi.load('user32.dll')
      const raw = user32.func(
        'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
      )
      this.keybdEvent = raw as unknown as KeybdEventFn
    } catch (error) {
      this.diagnostics.push(`input: ${String(error)}`)
    }
  }

  private initPower(): void {
    try {
      const kernel32 = koffi.load('kernel32.dll')
      const raw = kernel32.func(
        'bool __stdcall GetSystemPowerStatus(_Out_ SYSTEM_POWER_STATUS *lpSystemPowerStatus)'
      )
      this.powerStatus = raw as unknown as PowerStatusFn
    } catch (error) {
      this.diagnostics.push(`power: ${String(error)}`)
    }
  }

  /** 全屏检测三件套：前台句柄 / 窗口矩形 / 进程 ID。全部 best-effort，失败即视为无全屏 */
  private initDisplay(): void {
    try {
      const user32 = koffi.load('user32.dll')
      const fg = user32.func('intptr_t __stdcall GetForegroundWindow()')
      this.getForeground = fg as unknown as ForegroundFn
      const rect = user32.func(
        'bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ RECT *lpRect)'
      )
      this.getWindowRect = rect as unknown as WindowRectFn
      const pid = user32.func(
        'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'
      )
      this.getWindowPid = pid as unknown as WindowPidFn
    } catch (error) {
      this.diagnostics.push(`display: ${String(error)}`)
    }
  }

  /** 前台窗口矩形 + PID；空 = 拿不到（koffi 降级） */
  readForeground(): { rect: Record<string, number>; pid: number } | null {
    if (!this.getForeground || !this.getWindowRect || !this.getWindowPid) return null
    try {
      const hwnd = this.getForeground()
      if (!hwnd || Number(hwnd) === 0) return null
      const rectOut: Record<string, number> = {}
      if (!this.getWindowRect(hwnd, rectOut)) return null
      const pidOut = { pid: 0 }
      this.getWindowPid(hwnd, pidOut)
      return { rect: rectOut, pid: Number(pidOut.pid) }
    } catch (error) {
      this.diagnostics.push(`foreground: ${String(error)}`)
      return null
    }
  }

  tapKey(action: MediaKeyAction | VolumeKeyAction): boolean {
    const vk = VK_TABLE[action]
    if (vk === undefined || !this.keybdEvent) return false
    try {
      this.keybdEvent(vk, 0, KEYEVENTF_EXTENDEDKEY, 0)
      this.keybdEvent(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
      return true
    } catch (error) {
      this.diagnostics.push(`tapKey(${action}): ${String(error)}`)
      return false
    }
  }

  readBattery(): BatteryState {
    const fallback: BatteryState = { hasBattery: false, percent: -1, charging: false }
    if (!this.powerStatus) return fallback
    try {
      const out: Record<string, number> = {}
      if (!this.powerStatus(out)) return fallback

      const rawPercent = Number(out.BatteryLifePercent ?? 255)
      const acLine = Number(out.ACLineStatus ?? 255)
      const flag = Number(out.BatteryFlag ?? 128)
      const noSystemBattery = flag === 128 || flag === 255

      if (noSystemBattery || rawPercent > 100) {
        return { hasBattery: false, percent: -1, charging: acLine === 1 }
      }

      return {
        hasBattery: true,
        percent: rawPercent,
        charging: acLine === 1
      }
    } catch (error) {
      this.diagnostics.push(`battery: ${String(error)}`)
      return fallback
    }
  }

  probe(): { input: boolean; power: boolean } {
    return { input: this.keybdEvent !== null, power: this.powerStatus !== null }
  }
}

let layer: WinApiLayer | null = null

export function getWinApi(): WinApiLayer {
  if (!layer) layer = new WinApiLayer()
  return layer
}

export type { WinApiLayer }
