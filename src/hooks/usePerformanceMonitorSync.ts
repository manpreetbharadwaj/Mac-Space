import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { isTauriRuntime } from '@/services/environment'
import { configurePerformanceMonitor } from '@/services/tauri/bridge'
import { useI18n, type MessageKey } from '@/i18n'

/** Template keys the native monitor fills in — see MonitorConfig.text in performance.rs. */
const NOTIFICATION_TEMPLATES: Record<string, MessageKey> = {
  memoryTitle: 'notify.memoryTitle',
  memoryBody: 'notify.memoryBody',
  swapBody: 'notify.swapBody',
  appMemoryTitle: 'notify.appMemoryTitle',
  appMemoryBody: 'notify.appMemoryBody',
  cpuTitle: 'notify.cpuTitle',
  cpuBody: 'notify.cpuBody',
  appCpuTitle: 'notify.appCpuTitle',
  appCpuBody: 'notify.appCpuBody',
  storageTitle: 'notify.storageTitle',
  storageBody: 'notify.storageBody',
  batteryTitle: 'notify.batteryTitle',
  batteryBody: 'notify.batteryBody',
  levelElevated: 'notify.levelElevated',
  levelCritical: 'notify.levelCritical',
}

/**
 * Mirrors the user's performance/notification preferences — and the
 * notification text in their current language — to the native monitor.
 * The native side never samples or alerts until this has run once, so the
 * user's real settings (not defaults) always apply.
 */
export function usePerformanceMonitorSync() {
  const settings = useAppStore((s) => s.settings)
  const { t } = useI18n()

  useEffect(() => {
    if (!settings || !isTauriRuntime()) return
    const p = settings.performance
    const text = Object.fromEntries(Object.entries(NOTIFICATION_TEMPLATES).map(([k, key]) => [k, t(key)]))
    void configurePerformanceMonitor({
      enabled: p.monitoringEnabled,
      refreshIntervalMs: p.refreshIntervalSec * 1000,
      notificationsEnabled: settings.notificationsEnabled,
      memoryAlert: p.memoryAlert,
      cpuAlert: p.cpuAlert,
      appAlert: p.appAlert,
      storageAlert: p.storageAlert,
      batteryAlert: p.batteryAlert,
      sensitivity: p.sensitivity,
      cpuThresholdPercent: p.cpuThresholdPercent,
      appMemoryThresholdBytes: p.appMemoryThresholdGb * 1e9,
      storageFreeThresholdBytes: p.storageFreeThresholdGb * 1e9,
      cooldownMinutes: p.cooldownMinutes,
      text,
    }).catch((err) => console.error('configure_performance_monitor failed', err))
  }, [settings, t])
}
