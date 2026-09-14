export type SafetyLevel = 'green' | 'orange' | 'red'

export type StorageCategoryId =
  | 'developer'
  | 'browser'
  | 'applications'
  | 'downloads'
  | 'files'
  | 'system'
  | 'documents'
  | 'media'
  | 'other'

export interface DiskSummary {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  /**
   * OS-level space macOS itself considers reclaimable right now (local
   * snapshots, evictable caches) — already counted inside `freeBytes`, not
   * separate from it. Null in mock mode (macOS doesn't expose this to a
   * plain browser). Distinct from `reclaimableBytes`, which is space this
   * app specifically identified via scanning.
   */
  purgeableBytes: number | null
  reclaimableBytes: number
  lastScanAt: string | null
}

export interface StorageCategory {
  id: StorageCategoryId
  label: string
  usedBytes: number
  reclaimableBytes: number
  itemCount: number
}

export type DeveloperTool = 'xcode' | 'node' | 'android' | 'cocoapods' | 'docker' | 'general'
export type FileKind = 'large' | 'old' | 'download' | 'installer' | 'archive' | 'duplicate'

export interface CleanupItem {
  id: string
  name: string
  category: StorageCategoryId
  source: string
  tool?: DeveloperTool
  browserId?: BrowserId
  fileKind?: FileKind
  path: string
  sizeBytes: number
  ageDays: number
  lastUsedLabel: string
  safety: SafetyLevel
  whyItExists: string
  whatHappensIfCleaned: string
  selected: boolean
  excluded: boolean
}

export type UsageStatus = 'active' | 'infrequent' | 'not-used' | 'unknown'

export interface ApplicationItem {
  id: string
  name: string
  sizeBytes: number
  /** Null when we could not reliably determine a last-used date (never fabricated). */
  lastUsedAt: string | null
  lastUsedDaysAgo: number | null
  usageStatus: UsageStatus
  associatedCleanupBytes: number
  accent: string
  initial: string
}

export type ScanStatus = 'idle' | 'running' | 'completed'

export interface ScanSession {
  id: string
  startedAt: string
  completedAt: string | null
  foundBytes: number
  safeBytes: number
  reviewBytes: number
  status: ScanStatus
  biggestCategory: StorageCategoryId | null
}

export interface CategoryBreakdownEntry {
  category: StorageCategoryId
  bytes: number
}

export interface CleanupFailure {
  path: string
  name: string
  reason: string
}

export interface CleanupSession {
  id: string
  completedAt: string
  /**
   * Missing on old persisted sessions from before this field existed —
   * never assume a value; a `manual` fallback is safe since scheduled
   * auto-clean sessions are new starting now and always set it.
   */
  source?: 'manual' | 'scheduled-auto-clean'
  estimatedBytes: number
  /** For real (Tauri) cleanups: bytes successfully moved to Trash. For mock: the simulated reclaimed amount. */
  actualBytes: number
  itemIds: string[]
  categoryBreakdown: CategoryBreakdownEntry[]
  beforeUsedBytes: number
  afterUsedBytes: number
  itemCount: number
  /**
   * Real-cleanup-only fields (undefined in mock mode — never fabricated).
   * `actualBytes` above is "moved to Trash"; `freedOnDiskBytes` is the
   * separate, honest "immediately freed on disk" figure, which is usually
   * ~0 right after a move-to-Trash (the files still occupy the same disk
   * blocks until Trash is emptied).
   */
  successCount?: number
  failureCount?: number
  failures?: CleanupFailure[]
  freedOnDiskBytes?: number
}

export type ScheduleFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly'
export type ScheduleMode = 'reminder' | 'auto-clean'

export interface ScheduleRule {
  enabled: boolean
  frequency: ScheduleFrequency
  mode: ScheduleMode
  /** 24-hour "HH:MM", local time — e.g. "09:00". */
  timeOfDay: string
  safeCategories: StorageCategoryId[]
  thresholdFreeGb: number
  thresholdReclaimableGb: number
  emailSummaryEnabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  /**
   * The native auto-clean policy version (src-tauri/src/auto_clean.rs's
   * `POLICY_VERSION`) the user last explicitly confirmed via the Schedule
   * page's consent modal. The background job independently refuses to
   * auto-clean unless this is >= its own compiled-in policy version —
   * `mode: 'auto-clean'` alone is never sufficient. 0 means "never
   * consented."
   */
  autoCleanConsentVersion: number
}

/**
 * A scan-only event (manual or scheduled) — deliberately separate from
 * CleanupSession, which represents an actual cleanup. A scheduled run never
 * cleans anything, so it must never be recorded as one (see History page —
 * scan events are shown separately on the Schedule page instead).
 */
export interface ScanEvent {
  id: string
  occurredAt: string
  source: 'manual' | 'scheduled'
  foundBytes: number
  reclaimableBytes: number
  freeBytes: number
  notificationSent: boolean
}

export type ThemePreference = 'light' | 'dark' | 'system'

export interface Settings {
  theme: ThemePreference
  permanentDeleteEnabled: boolean
  exclusions: string[]
  notificationsEnabled: boolean
  analyticsOptIn: boolean
}

export type BrowserId = 'safari' | 'chrome' | 'firefox' | 'edge' | 'arc'

export interface BrowserProfile {
  id: BrowserId
  name: string
  accent: string
  cacheBytes: number
  cookiesBytes: number
  /** Null means "not scanned" (we never read passwords/bookmarks/etc) — distinct from a real zero. */
  passwordsCount: number | null
  bookmarksCount: number | null
  extensionsCount: number | null
  autofillEntries: number | null
  lastCleanedLabel: string
}

export type PermissionCategory = 'full-disk-access' | 'downloads' | 'documents' | 'browser-data'
export type PermissionState = 'granted' | 'denied' | 'not-requested'

export interface PermissionStatus {
  category: PermissionCategory
  label: string
  state: PermissionState
  reason: string
}
