import type {
  ApplicationItem,
  CleanupFailure,
  CleanupItem,
  CleanupSession,
  DiskSummary,
  PermissionState,
  PermissionStatus,
  ScanEvent,
  ScheduleRule,
  Settings,
  StorageCategory,
} from '@/types'
import { buildInitialScanSession } from '@/mocks'
import {
  checkPathAccess,
  getAppState,
  getNotificationPermissionState as bridgeGetNotificationPermissionState,
  getScheduleStatus as bridgeGetScheduleStatus,
  healSchedulePath,
  installSchedule,
  onCleanupProgress,
  onScanProgress,
  openFullDiskAccessSettings,
  openNotificationSettings as bridgeOpenNotificationSettings,
  removeSchedule,
  requestNotificationPermission as bridgeRequestNotificationPermission,
  revealInFinderNative,
  runFullScan,
  saveAppState,
  trashItems,
  type RawNotificationPermission,
} from './tauri/bridge'
import { buildRealCategories, buildRealDiskSummary, classifyFullScan, type ClassifiedScan } from './tauri/classify'
import { nextId } from '@/mocks/seed'
import type {
  CleanItemsResult,
  CleanMode,
  CleanupProgressUpdate,
  RunScanResult,
  ScanProgressUpdate,
  StorageService,
} from './storageServiceTypes'

/** Old browser-localStorage key, from before settings/schedule/history moved to a Rust-backed file (see state.rs) — read once, for migration only. */
const LEGACY_STORAGE_KEY = 'mac-storage-manager:tauri:v1'

interface PersistedRealState {
  settings: Settings
  schedule: ScheduleRule
  history: CleanupSession[]
  scanEvents: ScanEvent[]
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  permanentDeleteEnabled: false,
  exclusions: [],
  notificationsEnabled: true,
  analyticsOptIn: false,
}

const DEFAULT_SCHEDULE: ScheduleRule = {
  enabled: false,
  frequency: 'weekly',
  mode: 'reminder',
  timeOfDay: '09:00',
  safeCategories: ['developer', 'system', 'browser'],
  thresholdFreeGb: 40,
  thresholdReclaimableGb: 15,
  emailSummaryEnabled: false,
  lastRunAt: null,
  nextRunAt: null,
  autoCleanConsentVersion: 0,
}

function readLegacyLocalStorage(): Partial<PersistedRealState> | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<PersistedRealState> & { exclusions?: string[] }
  } catch {
    return null
  }
}

/**
 * Loads settings/schedule/history/scanEvents from the Rust-backed state
 * file (see src-tauri/src/state.rs) — a plain JSON blob on disk, readable
 * by both this running app AND the headless `--background-scan` process,
 * which has no WebView and therefore no access to localStorage at all.
 *
 * One-time migration: if the Rust file has never been written (brand new,
 * or upgrading from a build that only used localStorage), fold in whatever
 * was in the old localStorage key so existing settings/exclusions/history
 * aren't silently lost. The old key is left in place afterwards (harmless,
 * unused) rather than cleared, to minimize risk.
 */
async function loadPersisted(): Promise<PersistedRealState> {
  const raw = (await getAppState()) as Partial<PersistedRealState> | null

  if (raw && (raw.settings || raw.schedule || raw.history)) {
    return {
      settings: { ...DEFAULT_SETTINGS, ...raw.settings },
      schedule: { ...DEFAULT_SCHEDULE, ...raw.schedule },
      history: raw.history ?? [],
      scanEvents: raw.scanEvents ?? [],
    }
  }

  // Nothing in the new store yet — check the legacy localStorage key.
  const legacy = readLegacyLocalStorage()
  if (legacy) {
    const settings = legacy.settings ?? DEFAULT_SETTINGS
    // Even-older migration this file already handled: a top-level
    // `exclusions` array disconnected from `settings.exclusions`.
    const legacyExclusions = (legacy as { exclusions?: string[] }).exclusions
    const exclusions = legacyExclusions?.length
      ? Array.from(new Set([...settings.exclusions, ...legacyExclusions]))
      : settings.exclusions
    return {
      settings: { ...settings, exclusions },
      schedule: { ...DEFAULT_SCHEDULE, ...legacy.schedule },
      history: legacy.history ?? [],
      scanEvents: [],
    }
  }

  return { settings: DEFAULT_SETTINGS, schedule: DEFAULT_SCHEDULE, history: [], scanEvents: [] }
}

function mapNotificationPermission(raw: RawNotificationPermission): PermissionState {
  return raw === 'prompt' ? 'not-requested' : raw
}

/**
 * Real macOS implementation of StorageService, backed by Tauri commands.
 *
 * `settings.exclusions` is the ONE source of truth for exclusions (matching
 * MockStorageService) — there is no separate exclusions list. `this.scan`
 * holds the raw, un-excluded scan result; every read derives `excluded` (and
 * therefore categories/diskSummary/scanSession) fresh from the current
 * exclusions list via currentItems()/currentCategories()/currentDiskSummary(),
 * so removing a path from Settings → Exclusions makes it eligible again
 * immediately, with no rescan required.
 *
 * cleanItems() performs a REAL move-to-Trash via the native `trash_items`
 * command — see src-tauri/src/trash.rs. It never permanently deletes: even
 * when `mode === 'permanent'` is requested, this phase only ever trashes
 * (Settings' permanentDeleteEnabled is intentionally not wired to any
 * irreversible native operation yet).
 */
export class TauriStorageService implements StorageService {
  private local: PersistedRealState | null = null
  private localPromise: Promise<PersistedRealState> | null = null
  private scan: ClassifiedScan | null = null
  private scanPromise: Promise<ClassifiedScan> | null = null

  private async ensureLocal(): Promise<PersistedRealState> {
    if (this.local) return this.local
    if (!this.localPromise) {
      this.localPromise = loadPersisted().then((loaded) => {
        this.local = loaded
        // Fire-and-forget: if a schedule is enabled, make sure the
        // installed LaunchAgent (if any) still points at this app's
        // current path — a no-op unless the app has moved since install.
        if (loaded.schedule.enabled) {
          void healSchedulePath(loaded.schedule.frequency, loaded.schedule.timeOfDay)
        }
        return loaded
      })
    }
    return this.localPromise
  }

  private async persistLocal() {
    if (!this.local) return
    try {
      await saveAppState(this.local)
    } catch (err) {
      console.error('Failed to persist app state:', err)
    }
  }

  private currentItems(): CleanupItem[] {
    if (!this.scan || !this.local) return []
    const excludedPaths = new Set(this.local.settings.exclusions)
    return this.scan.items.map((item) =>
      excludedPaths.has(item.path)
        ? { ...item, excluded: true, selected: false }
        : { ...item, excluded: false },
    )
  }

  private currentCategories(): StorageCategory[] {
    if (!this.scan) return []
    return buildRealCategories(this.currentItems(), this.scan.applications, this.scan.overview.usedBytes)
  }

  private currentDiskSummary(): DiskSummary {
    if (!this.scan) {
      return { totalBytes: 0, usedBytes: 0, freeBytes: 0, purgeableBytes: null, reclaimableBytes: 0, lastScanAt: null }
    }
    return buildRealDiskSummary(
      this.currentCategories(),
      this.scan.overview.totalBytes,
      this.scan.overview.usedBytes,
      this.scan.overview.freeBytes,
      this.scan.overview.purgeableBytes,
      this.scan.diskSummary.lastScanAt,
    )
  }

  private async ensureScanned(onProgress?: (update: ScanProgressUpdate) => void): Promise<ClassifiedScan> {
    await this.ensureLocal()
    if (this.scan) return this.scan
    return this.performScan(onProgress)
  }

  private async performScan(onProgress?: (update: ScanProgressUpdate) => void): Promise<ClassifiedScan> {
    if (this.scanPromise) return this.scanPromise

    this.scanPromise = (async () => {
      const unlisten = onProgress
        ? await onScanProgress((event) => onProgress({ phase: event.phase, label: event.label }))
        : null
      try {
        const raw = await runFullScan()
        const classified = classifyFullScan(raw)
        this.scan = classified
        return classified
      } finally {
        unlisten?.()
        this.scanPromise = null
      }
    })()

    return this.scanPromise
  }

  async getDiskSummary() {
    await this.ensureScanned()
    return this.currentDiskSummary()
  }

  async getCategories() {
    await this.ensureScanned()
    return this.currentCategories()
  }

  async getCleanupItems() {
    await this.ensureScanned()
    return this.currentItems()
  }

  async getScanSession() {
    await this.ensureScanned()
    return buildInitialScanSession(this.currentItems())
  }

  async runScan(_options?: { mode: 'quick' | 'deep' }, onProgress?: (update: ScanProgressUpdate) => void): Promise<RunScanResult> {
    const local = await this.ensureLocal()
    await this.performScan(onProgress)
    const diskSummary = this.currentDiskSummary()

    // Recorded as a "manual" ScanEvent — same shape as a scheduled run's
    // record (see background.rs), but never touches schedule.lastRunAt or
    // history (this is a scan, not a cleanup — no space was freed).
    const scanEvent: ScanEvent = {
      id: nextId('scan'),
      occurredAt: new Date().toISOString(),
      source: 'manual',
      foundBytes: diskSummary.usedBytes,
      reclaimableBytes: diskSummary.reclaimableBytes,
      freeBytes: diskSummary.freeBytes,
      notificationSent: false,
    }
    local.scanEvents = [scanEvent, ...local.scanEvents].slice(0, 50)
    await this.persistLocal()

    return { scanSession: buildInitialScanSession(this.currentItems()), categories: this.currentCategories(), diskSummary }
  }

  async getApplications(): Promise<ApplicationItem[]> {
    const scan = await this.ensureScanned()
    return scan.applications
  }

  async getBrowserProfiles() {
    const scan = await this.ensureScanned()
    return scan.browserProfiles
  }

  /**
   * Real cleanup: moves each selected item to the macOS Trash via the native
   * `trash_items` command. Never permanently deletes — `mode` is accepted
   * for interface compatibility but always results in a Trash move; this is
   * intentional for this phase (see class doc comment). Partial success is
   * expected and handled: failed items are reported back with a reason and
   * are never removed from the cached scan, so they remain visible to retry.
   */
  async cleanItems(
    ids: string[],
    _mode: CleanMode,
    onProgress?: (update: CleanupProgressUpdate) => void,
  ): Promise<CleanItemsResult> {
    const local = await this.ensureLocal()
    await this.ensureScanned()
    const idSet = new Set(ids)
    const targeted = this.currentItems().filter((item) => idSet.has(item.id))

    const unlisten = onProgress
      ? await onCleanupProgress((event) => onProgress({ phase: event.phase, label: event.label }))
      : null

    let raw
    try {
      raw = await trashItems(
        targeted.map((item) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          sizeBytes: item.sizeBytes,
          safety: item.safety,
        })),
      )
    } finally {
      unlisten?.()
    }

    const successIds: string[] = []
    const failures: CleanupFailure[] = []
    let movedToTrashBytes = 0
    const categoryTotals = new Map<string, number>()

    for (const result of raw.results) {
      const item = targeted.find((i) => i.id === result.id)
      if (result.success) {
        successIds.push(result.id)
        movedToTrashBytes += result.bytesProcessed
        if (item) categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + result.bytesProcessed)
      } else {
        failures.push({
          path: result.path,
          name: item?.name ?? result.path,
          reason: result.failureReason ?? 'Unknown error',
        })
      }
    }

    // Remove only the successfully-trashed items from the raw cached scan —
    // failed items stay exactly where they were, still selectable/visible.
    if (this.scan) {
      const successIdSet = new Set(successIds)
      this.scan = {
        ...this.scan,
        items: this.scan.items.filter((item) => !successIdSet.has(item.id)),
        overview: {
          ...this.scan.overview,
          totalBytes: raw.overviewAfter.totalBytes,
          usedBytes: raw.overviewAfter.usedBytes,
          freeBytes: raw.overviewAfter.freeBytes,
          purgeableBytes: raw.overviewAfter.purgeableBytes,
        },
      }
    }

    const estimatedBytes = targeted.reduce((sum, item) => sum + item.sizeBytes, 0)
    // Moving files to Trash on the same volume does not free disk space —
    // this is the honest, separate "actually freed right now" figure, almost
    // always ~0 immediately after a move-to-Trash.
    const freedOnDiskBytes = Math.max(0, raw.overviewBefore.usedBytes - raw.overviewAfter.usedBytes)

    const session: CleanupSession = {
      id: nextId('cleanup'),
      completedAt: new Date().toISOString(),
      source: 'manual',
      estimatedBytes,
      actualBytes: movedToTrashBytes,
      itemIds: successIds,
      categoryBreakdown: Array.from(categoryTotals.entries()).map(([category, bytes]) => ({
        category: category as CleanupItem['category'],
        bytes,
      })),
      beforeUsedBytes: raw.overviewBefore.usedBytes,
      afterUsedBytes: raw.overviewAfter.usedBytes,
      itemCount: successIds.length,
      successCount: successIds.length,
      failureCount: failures.length,
      failures,
      freedOnDiskBytes,
    }

    // Deliberately does NOT touch schedule.lastRunAt — that field now means
    // specifically "last time the scheduled background job ran" (updated
    // by the native side, see src-tauri/src/background.rs), not "last time
    // anything happened." Conflating the two would make the Schedule
    // screen misreport whether background scheduling is actually working.
    local.history = [session, ...local.history]
    await this.persistLocal()

    return {
      session,
      diskSummary: this.currentDiskSummary(),
      categories: this.currentCategories(),
      remainingItems: this.currentItems(),
      successIds,
      failures,
    }
  }

  async excludeItem(id: string): Promise<CleanupItem[]> {
    const local = await this.ensureLocal()
    const items = this.currentItems()
    const target = items.find((item) => item.id === id)
    if (target && !local.settings.exclusions.includes(target.path)) {
      local.settings = { ...local.settings, exclusions: [...local.settings.exclusions, target.path] }
      await this.persistLocal()
    }
    return this.currentItems()
  }

  async revealInFinder(path: string): Promise<void> {
    await revealInFinderNative(path)
  }

  /**
   * Real application uninstall is deferred to a later phase (associated
   * Application Support/preferences/cache data needs separate safety
   * handling). The Applications screen disables this control entirely in
   * real-data mode, so this is only a defensive no-op fallback.
   */
  async uninstallApp(_id: string): Promise<ApplicationItem[]> {
    const scan = await this.ensureScanned()
    return scan.applications
  }

  async getPermissions(): Promise<PermissionStatus[]> {
    const scan = await this.ensureScanned()
    const [downloads, documents] = await Promise.all([
      checkPathAccess(`${scan.overview.homeDir}/Downloads`),
      checkPathAccess(`${scan.overview.homeDir}/Documents`),
    ])
    const safariAccessible = scan.browserProfiles.length > 0 // populated only when at least readable

    return [
      {
        category: 'full-disk-access',
        label: 'Full Disk Access',
        state: safariAccessible ? 'granted' : 'denied',
        reason: 'Needed to see the true size of caches and app support folders outside your home directory.',
      },
      {
        category: 'downloads',
        label: 'Downloads Folder',
        state: mapAccessState(downloads.state),
        reason: 'Needed to find old installers, archives, and duplicate downloads.',
      },
      {
        category: 'documents',
        label: 'Documents Folder',
        state: mapAccessState(documents.state),
        reason: 'Needed to flag large or old documents for your review.',
      },
      {
        category: 'browser-data',
        label: 'Browser Data Access',
        state: safariAccessible ? 'granted' : 'denied',
        reason: 'Needed only to size browser caches — cookies and passwords are never read.',
      },
    ]
  }

  async requestPermission(category: PermissionStatus['category']): Promise<PermissionStatus[]> {
    if (category === 'full-disk-access' || category === 'browser-data') {
      await openFullDiskAccessSettings()
    } else if (category === 'downloads' || category === 'documents') {
      // No special grant flow needed for these — just re-check current access.
      this.scan = null
    }
    return this.getPermissions()
  }

  async getSchedule() {
    const local = await this.ensureLocal()
    return local.schedule
  }

  /**
   * Installs/updates the native LaunchAgent when `rule.enabled`, or removes
   * it when disabled — see src-tauri/src/schedule.rs. `nextRunAt` on the
   * persisted/returned rule always reflects what the native side actually
   * computed, never a value invented on the frontend.
   */
  async saveSchedule(rule: ScheduleRule) {
    const local = await this.ensureLocal()
    let resolved: ScheduleRule
    if (rule.enabled) {
      const nextRunAt = await installSchedule(rule.frequency, rule.timeOfDay)
      resolved = { ...rule, nextRunAt }
    } else {
      await removeSchedule()
      resolved = { ...rule, nextRunAt: null }
    }
    local.schedule = resolved
    await this.persistLocal()
    return local.schedule
  }

  /** Whether the LaunchAgent is actually loaded right now — a diagnostic, not the source of truth for `schedule.enabled`. */
  async getScheduleStatus(): Promise<boolean> {
    return bridgeGetScheduleStatus()
  }

  async getScanEvents(): Promise<ScanEvent[]> {
    const local = await this.ensureLocal()
    return local.scanEvents
  }

  async getHistory() {
    const local = await this.ensureLocal()
    return local.history
  }

  async getSettings() {
    const local = await this.ensureLocal()
    return local.settings
  }

  async saveSettings(settings: Settings) {
    const local = await this.ensureLocal()
    local.settings = settings
    await this.persistLocal()
    return local.settings
  }

  async getNotificationPermissionState(): Promise<PermissionState> {
    return mapNotificationPermission(await bridgeGetNotificationPermissionState())
  }

  /**
   * Triggers the OS permission flow. NOTE (verified by reading
   * tauri-plugin-notification 2.4.0's desktop source): on macOS this
   * currently always resolves to "granted" rather than reflecting a real
   * user decision — a known upstream limitation, not something this app
   * can see through. The "Open Notification Settings" button is offered
   * unconditionally alongside this for exactly that reason — it's the only
   * fully reliable way for the user to check/fix the real OS setting.
   */
  async requestNotificationPermission(): Promise<PermissionState> {
    return mapNotificationPermission(await bridgeRequestNotificationPermission())
  }

  async openNotificationSettings(): Promise<void> {
    await bridgeOpenNotificationSettings()
  }

  async resetDemoData(): Promise<void> {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // ignore
    }
    await removeSchedule().catch(() => {})
    this.local = { settings: DEFAULT_SETTINGS, schedule: DEFAULT_SCHEDULE, history: [], scanEvents: [] }
    this.localPromise = Promise.resolve(this.local)
    this.scan = null
    await this.persistLocal()
  }
}

function mapAccessState(state: 'accessible' | 'denied' | 'not-found'): PermissionStatus['state'] {
  if (state === 'accessible') return 'granted'
  if (state === 'not-found') return 'not-requested'
  return 'denied'
}

export const tauriStorageService = new TauriStorageService()
