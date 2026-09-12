import type {
  ApplicationItem,
  CleanupFailure,
  CleanupItem,
  CleanupSession,
  DiskSummary,
  PermissionStatus,
  ScheduleRule,
  Settings,
  StorageCategory,
} from '@/types'
import { buildInitialScanSession } from '@/mocks'
import {
  checkPathAccess,
  onCleanupProgress,
  onScanProgress,
  openFullDiskAccessSettings,
  revealInFinderNative,
  runFullScan,
  trashItems,
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

const STORAGE_KEY = 'mac-storage-manager:tauri:v1'

interface PersistedRealState {
  settings: Settings
  schedule: ScheduleRule
  history: CleanupSession[]
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
  safeCategories: ['developer', 'system', 'browser'],
  thresholdFreeGb: 40,
  thresholdReclaimableGb: 15,
  emailSummaryEnabled: false,
  lastRunAt: null,
  nextRunAt: null,
}

function loadPersisted(): PersistedRealState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedRealState> & { exclusions?: string[] }
      // Migration: an earlier build stored a separate top-level `exclusions`
      // array, disconnected from `settings.exclusions` (the Settings screen
      // only ever showed/edited the latter). Fold any such leftover list in
      // once, so paths excluded under the old scheme aren't silently lost.
      const settings = parsed.settings ?? DEFAULT_SETTINGS
      if (parsed.exclusions?.length) {
        const merged = new Set([...settings.exclusions, ...parsed.exclusions])
        return {
          settings: { ...settings, exclusions: Array.from(merged) },
          schedule: parsed.schedule ?? DEFAULT_SCHEDULE,
          history: parsed.history ?? [],
        }
      }
      return {
        settings,
        schedule: parsed.schedule ?? DEFAULT_SCHEDULE,
        history: parsed.history ?? [],
      }
    }
  } catch {
    // fall through to defaults
  }
  return { settings: DEFAULT_SETTINGS, schedule: DEFAULT_SCHEDULE, history: [] }
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
  private local: PersistedRealState = loadPersisted()
  private scan: ClassifiedScan | null = null
  private scanPromise: Promise<ClassifiedScan> | null = null

  private persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.local))
    } catch {
      // localStorage unavailable — session continues without persistence
    }
  }

  private currentItems(): CleanupItem[] {
    if (!this.scan) return []
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
    await this.performScan(onProgress)
    return { scanSession: buildInitialScanSession(this.currentItems()), categories: this.currentCategories(), diskSummary: this.currentDiskSummary() }
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

    this.local.history = [session, ...this.local.history]
    this.local.schedule = { ...this.local.schedule, lastRunAt: session.completedAt }
    this.persistLocal()

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
    const items = this.currentItems()
    const target = items.find((item) => item.id === id)
    if (target && !this.local.settings.exclusions.includes(target.path)) {
      this.local.settings = { ...this.local.settings, exclusions: [...this.local.settings.exclusions, target.path] }
      this.persistLocal()
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
    return this.local.schedule
  }

  async saveSchedule(rule: ScheduleRule) {
    this.local.schedule = rule
    this.persistLocal()
    return this.local.schedule
  }

  async getHistory() {
    return this.local.history
  }

  async getSettings() {
    return this.local.settings
  }

  async saveSettings(settings: Settings) {
    this.local.settings = settings
    this.persistLocal()
    return this.local.settings
  }

  async resetDemoData(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY)
    this.local = { settings: DEFAULT_SETTINGS, schedule: DEFAULT_SCHEDULE, history: [] }
    this.scan = null
    this.persistLocal()
  }
}

function mapAccessState(state: 'accessible' | 'denied' | 'not-found'): PermissionStatus['state'] {
  if (state === 'accessible') return 'granted'
  if (state === 'not-found') return 'not-requested'
  return 'denied'
}

export const tauriStorageService = new TauriStorageService()
