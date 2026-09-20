import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import type { IslandSettings } from '../../shared/types'

export const DEFAULT_SETTINGS: IslandSettings = {
  theme: 'dark',
  accent: '#0a84ff',
  accentFromCover: true,
  opacity: 0.97,
  scale: 1,
  topOffset: 6,
  hideOnFullscreen: false,
  alwaysOnTop: true,
  autoStart: false,
  clipboardEnabled: true,
  clipboardLimit: 60,
  idleClock: true,
  motion: 'full',
  shadow: true,
  soundEnabled: true,
  weatherCity: '',
  activeSkin: '',
  gameMode: true,
  gameExclude: ['explorer.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe'],
  companionEnabled: true,
  modules: {
    media: true,
    system: true,
    clipboard: true,
    volume: true
  }
}

function mergeSettings(base: IslandSettings, patch: unknown): IslandSettings {
  if (!patch || typeof patch !== 'object') return base
  const source = patch as Partial<IslandSettings>
  return {
    ...base,
    ...source,
    modules: {
      ...base.modules,
      ...(source.modules ?? {})
    }
  }
}

export class SettingsStore {
  private readonly filePath: string
  private current: IslandSettings

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // 兼容旧版本遗留的配置文件
    const legacy = path.join(dir, 'island-settings.json')
    this.filePath = path.join(dir, 'eave-settings.json')
    if (!existsSync(this.filePath) && existsSync(legacy)) {
      try {
        renameSync(legacy, this.filePath)
      } catch {
        /* 迁移失败就用新文件 */
      }
    }
    this.current = this.load()
  }

  get value(): IslandSettings {
    return this.current
  }

  get location(): string {
    return this.filePath
  }

  private load(): IslandSettings {
    try {
      if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
      const raw = readFileSync(this.filePath, 'utf-8')
      return mergeSettings({ ...DEFAULT_SETTINGS }, JSON.parse(raw))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  patch(changes: Partial<IslandSettings>): IslandSettings {
    this.current = mergeSettings(this.current, changes)
    this.persist()
    return this.current
  }

  reset(): IslandSettings {
    this.current = { ...DEFAULT_SETTINGS, modules: { ...DEFAULT_SETTINGS.modules } }
    this.persist()
    return this.current
  }

  private persist(): void {
    try {
      const temp = `${this.filePath}.tmp`
      writeFileSync(temp, JSON.stringify(this.current, null, 2), 'utf-8')
      renameSync(temp, this.filePath)
    } catch {
      /* ignore persistence failures, defaults remain in memory */
    }
  }
}
