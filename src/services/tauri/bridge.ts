import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  RawFullScanResult,
  RawPathAccess,
  RawScanProgressEvent,
  RawSystemOverview,
  RawTrashOperationResult,
  RawTrashRequestItem,
} from './rawTypes'
import type {
  MonitorConfigPayload,
  NativeNotificationStatus,
  RawBattery,
  RawDeviceInfo,
  RawLoginItemStatus,
  RawPerformanceSnapshot,
  RawProcessDetails,
  RawProcessList,
  RawStorageHealth,
  RawTerminateResult,
  RawTestNotificationResult,
} from './systemTypes'

export function getSystemOverview(): Promise<RawSystemOverview> {
  return invoke('get_system_overview')
}

export function checkPathAccess(path: string): Promise<RawPathAccess> {
  return invoke('check_path_access', { path })
}

export function revealInFinderNative(path: string): Promise<void> {
  return invoke('reveal_in_finder', { path })
}

export function openFullDiskAccessSettings(): Promise<void> {
  return invoke('open_full_disk_access_settings')
}

export function runFullScan(): Promise<RawFullScanResult> {
  return invoke('run_full_scan')
}

export function onScanProgress(callback: (event: RawScanProgressEvent) => void): Promise<UnlistenFn> {
  return listen<RawScanProgressEvent>('scan-progress', (e) => callback(e.payload))
}

export function trashItems(items: RawTrashRequestItem[]): Promise<RawTrashOperationResult> {
  return invoke('trash_items', { items })
}

export function onCleanupProgress(callback: (event: RawScanProgressEvent) => void): Promise<UnlistenFn> {
  return listen<RawScanProgressEvent>('cleanup-progress', (e) => callback(e.payload))
}

// --- Persisted app state (settings/schedule/history/scanEvents) — see src-tauri/src/state.rs ---

export function getAppState(): Promise<unknown> {
  return invoke('get_app_state')
}

export function saveAppState(state: unknown): Promise<void> {
  return invoke('save_app_state', { state })
}

// --- Scheduled background scans — see src-tauri/src/schedule.rs ---

/** Installs/replaces the LaunchAgent; returns the freshly computed nextRunAt (RFC3339). */
export function installSchedule(frequency: string, timeOfDay: string): Promise<string> {
  return invoke('install_schedule', { frequency, timeOfDay })
}

export function removeSchedule(): Promise<void> {
  return invoke('remove_schedule')
}

export function getScheduleStatus(): Promise<boolean> {
  return invoke('get_schedule_status')
}

export function healSchedulePath(frequency: string, timeOfDay: string): Promise<void> {
  return invoke('heal_schedule_path', { frequency, timeOfDay })
}

// --- Notifications — see src-tauri/src/commands.rs ---

export type RawNotificationPermission = 'granted' | 'denied' | 'prompt'

export function getNotificationPermissionState(): Promise<RawNotificationPermission> {
  return invoke('get_notification_permission_state')
}

export function requestNotificationPermission(): Promise<RawNotificationPermission> {
  return invoke('request_notification_permission')
}

export function openNotificationSettings(): Promise<void> {
  return invoke('open_notification_settings')
}

// --- Notification click -> route handoff — see src-tauri/src/native_notifications.rs ---

/** Consumes (clears) the route a notification click resolved to, if any — call once on startup. */
export function getPendingNotificationRoute(): Promise<string | null> {
  return invoke('get_pending_notification_route')
}

/** Fires when a notification is clicked while this app's frontend is already mounted and running. */
export function onNotificationRoute(callback: (route: string) => void): Promise<UnlistenFn> {
  return listen<string>('notification-route', (e) => callback(e.payload))
}

// --- External links — see src-tauri/src/external_url.rs ---

/** Opens an allowlisted https link in the user's default browser; rejects with a readable message otherwise. */
export function openExternalUrl(url: string): Promise<void> {
  return invoke('open_external_url', { url })
}

// --- Performance & Mac Health — see src-tauri/src/{performance,processes,device_health,login_item}.rs ---

export function configurePerformanceMonitor(config: MonitorConfigPayload): Promise<void> {
  return invoke('configure_performance_monitor', { config })
}

export function setPerformanceViewActive(active: boolean): Promise<void> {
  return invoke('set_performance_view_active', { active })
}

/** `null` when monitoring is turned off in Settings. */
export function getPerformanceSnapshot(): Promise<RawPerformanceSnapshot | null> {
  return invoke('get_performance_snapshot')
}

export function getRunningProcesses(): Promise<RawProcessList> {
  return invoke('get_running_processes')
}

export function getProcessDetails(pid: number): Promise<RawProcessDetails | null> {
  return invoke('get_process_details', { pid })
}

/** `startTime` must be the kernel start time the user was shown — the native side refuses a recycled PID. */
export function terminateProcess(pid: number, startTime: number, force: boolean): Promise<RawTerminateResult> {
  return invoke('terminate_process', { pid, startTime, force })
}

export function getAppIcons(pids: number[]): Promise<Record<number, string>> {
  return invoke('get_app_icons', { pids })
}

export function getDeviceInfo(): Promise<RawDeviceInfo> {
  return invoke('get_device_info')
}

/** Only on an explicit user "Reveal" action. */
export function revealSerialNumber(): Promise<string | null> {
  return invoke('reveal_serial_number')
}

export function getStorageHealth(): Promise<RawStorageHealth> {
  return invoke('get_storage_health')
}

export function getBatteryHealth(): Promise<RawBattery> {
  return invoke('get_battery_health')
}

export function getNativeNotificationStatus(): Promise<NativeNotificationStatus> {
  return invoke('get_native_notification_status')
}

export function sendTestNotification(title: string, body: string): Promise<RawTestNotificationResult> {
  return invoke('send_test_notification', { title, body })
}

export function getLoginItemStatus(): Promise<RawLoginItemStatus> {
  return invoke('get_login_item_status')
}

export function setLoginItemEnabled(enabled: boolean): Promise<RawLoginItemStatus> {
  return invoke('set_login_item_enabled', { enabled })
}

export function openLoginItemsSettings(): Promise<void> {
  return invoke('open_login_items_settings')
}
