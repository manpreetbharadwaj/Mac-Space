import type {
  ApplicationItem,
  BrowserProfile,
  CleanupItem,
  CleanupSession,
  DiskSummary,
  PermissionStatus,
  ScanSession,
  ScheduleRule,
  Settings,
  StorageCategory,
} from '@/types'

export type CleanMode = 'trash' | 'permanent'

export interface ScanProgressUpdate {
  /** Stable key, e.g. "developer" | "browsers" | "applications" | "files" — see PHASE_ORDER in Scan.tsx. */
  phase: string
  label: string
}

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
  cleanItems(ids: string[], mode: CleanMode): Promise<CleanItemsResult>
  excludeItem(id: string): Promise<CleanupItem[]>
  revealInFinder(path: string): Promise<void>
  uninstallApp(id: string): Promise<ApplicationItem[]>
  getPermissions(): Promise<PermissionStatus[]>
  requestPermission(category: PermissionStatus['category']): Promise<PermissionStatus[]>
  getSchedule(): Promise<ScheduleRule>
  saveSchedule(rule: ScheduleRule): Promise<ScheduleRule>
  getHistory(): Promise<CleanupSession[]>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  resetDemoData(): Promise<void>
}
