import type {
  ApplicationItem,
  BrowserProfile,
  CleanupFailure,
  CleanupItem,
  CleanupSession,
  DiskSummary,
  PermissionState,
  PermissionStatus,
  ScanEvent,
  ScanSession,
  ScheduleRule,
  Settings,
  StorageCategory,
} from '@/types'

export type CleanMode = 'trash' | 'permanent'

/** Shared shape for both the scan and cleanup progress event channels. */
export interface ProgressUpdate {
  phase: string
  label: string
}

/** Stable key, e.g. "developer" | "browsers" | "applications" | "files" — see PHASE_ORDER in Scan.tsx. */
export type ScanProgressUpdate = ProgressUpdate
/** Stable key, e.g. "preparing" | "moving" | "verifying" | "done" — see CLEANUP_PHASE in CleanupActionBar.tsx. */
export type CleanupProgressUpdate = ProgressUpdate

export interface RunScanResult {
  scanSession: ScanSession
  categories: StorageCategory[]
  diskSummary: DiskSummary
}

export interface CleanItemsResult {
  session: CleanupSession
  diskSummary: DiskSummary
  categories: StorageCategory[]
  remainingItems: CleanupItem[]
  /**
   * Real-cleanup-only (undefined in mock mode, where every item always
   * succeeds). When present, the UI should only clear selection for/remove
   * `successIds` — `failures` should stay selected/visible so the user can
   * see and retry them.
   */
  successIds?: string[]
  failures?: CleanupFailure[]
}

/**
 * Abstract contract for all system-like data. Two implementations exist:
 * MockStorageService (browser prototype, mock data) and TauriStorageService
 * (real macOS data via Tauri commands). The UI and Zustand store only ever
 * depend on this interface — see services/storageService.ts for selection.
 */
export interface StorageService {
  getDiskSummary(): Promise<DiskSummary>
  getCategories(): Promise<StorageCategory[]>
  getCleanupItems(): Promise<CleanupItem[]>
  getScanSession(): Promise<ScanSession>
  /**
   * `onProgress` is only meaningful for the real Tauri implementation (fed by
   * actual backend scan phases); MockStorageService ignores it entirely and
   * keeps its own fixed-timer animation in Scan.tsx unchanged.
   */
  runScan(
    options?: { mode: 'quick' | 'deep' },
    onProgress?: (update: ScanProgressUpdate) => void,
  ): Promise<RunScanResult>
  getApplications(): Promise<ApplicationItem[]>
  getBrowserProfiles(): Promise<BrowserProfile[]>
  /**
   * `onProgress` is only meaningful for the real Tauri implementation (fed by
   * actual native Trash progress); MockStorageService ignores it.
   */
  cleanItems(
    ids: string[],
    mode: CleanMode,
    onProgress?: (update: CleanupProgressUpdate) => void,
  ): Promise<CleanItemsResult>
  excludeItem(id: string): Promise<CleanupItem[]>
  revealInFinder(path: string): Promise<void>
  uninstallApp(id: string): Promise<ApplicationItem[]>
  getPermissions(): Promise<PermissionStatus[]>
  requestPermission(category: PermissionStatus['category']): Promise<PermissionStatus[]>
  getSchedule(): Promise<ScheduleRule>
  /**
   * Saving an enabled schedule installs/updates the native background
   * scheduler (a launchd LaunchAgent — see src-tauri/src/schedule.rs);
   * saving a disabled one removes it. No-op in mock mode. `nextRunAt` on
   * the returned rule reflects whatever the native side actually computed.
   */
  saveSchedule(rule: ScheduleRule): Promise<ScheduleRule>
  /** Whether the native scheduler is currently installed — diagnostic only, for the Schedule screen. Mock mode mirrors `schedule.enabled`. */
  getScheduleStatus(): Promise<boolean>
  /** Scan-only events (manual or scheduled) — never cleanup. See ScanEvent. */
  getScanEvents(): Promise<ScanEvent[]>
  getHistory(): Promise<CleanupSession[]>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  /**
   * Best-effort — see the caveat on TauriStorageService.getNotificationPermissionState:
   * the underlying Tauri plugin cannot currently distinguish real OS denial
   * from "granted" on desktop, so this should never be presented as a
   * certain OS-level fact in the UI.
   */
  getNotificationPermissionState(): Promise<PermissionState>
  requestNotificationPermission(): Promise<PermissionState>
  openNotificationSettings(): Promise<void>
  resetDemoData(): Promise<void>
}
