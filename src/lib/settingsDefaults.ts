import type { PerformanceSettings, Settings } from '@/types'

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  monitoringEnabled: true,
  refreshIntervalSec: 2,
  memoryAlert: true,
  cpuAlert: true,
  appAlert: true,
  storageAlert: true,
  // Optional/informational per the product brief — off unless the user opts in.
  batteryAlert: false,
  sensitivity: 'balanced',
  cpuThresholdPercent: 85,
  appMemoryThresholdGb: 4,
  storageFreeThresholdGb: 10,
  cooldownMinutes: 30,
}

/**
 * Fills in fields added after a user's settings were first persisted
 * (language, performance) without touching anything they already chose.
 * Both storage services run every loaded settings blob through this.
 */
export function normalizeSettings(raw: Partial<Settings> | undefined, base: Settings): Settings {
  const merged = { ...base, ...raw }
  return {
    ...merged,
    language: merged.language ?? 'system',
    performance: { ...DEFAULT_PERFORMANCE_SETTINGS, ...(raw?.performance ?? {}) },
  }
}
