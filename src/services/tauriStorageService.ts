import type {
  ApplicationItem,
  CleanupItem,
  CleanupSession,
  PermissionStatus,
  ScheduleRule,
  Settings,
} from '@/types'
import { checkPathAccess, onScanProgress, openFullDiskAccessSettings, revealInFinderNative, runFullScan } from './tauri/bridge'
import { buildRealCategories, classifyFullScan, type ClassifiedScan } from './tauri/classify'
import { nextId } from '@/mocks/seed'
import type { CleanItemsResult, CleanMode, RunScanResult, ScanProgressUpdate, StorageService } from './storageServiceTypes'

const STORAGE_KEY = 'mac-storage-manager:tauri:v1'

interface PersistedRealState {
  settings: Settings
  schedule: ScheduleRule
  history: CleanupSession[]
  exclusions: string[]
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
    if (raw) return JSON.parse(raw) as PersistedRealState
  } catch {
    // fall through to defaults
  }
  return { settings: DEFAULT_SETTINGS, schedule: DEFAULT_SCHEDULE, history: [], exclusions: [] }
}

/**
 * Real macOS implementation of StorageService, backed by Tauri commands.
 * Read-only for this phase: cleanItems/uninstallApp never touch real files —
 * see the comments on each for exactly what's simulated and why.
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

  private applyExclusions(items: CleanupItem[]): CleanupItem[] {
    const excludedPaths = new Set(this.local.exclusions)
    return items.map((item) => (excludedPaths.has(item.path) ? { ...item, excluded: true } : item))
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
        classified.items = this.applyExclusions(classified.items)
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
    const scan = await this.ensureScanned()
    return scan.diskSummary
  }

  async getCategories() {
    const scan = await this.ensureScanned()
    return scan.categories
  }

  async getCleanupItems() {
    const scan = await this.ensureScanned()
    return scan.items
  }

  async getScanSession() {
    const scan = await this.ensureScanned()
    return scan.scanSession
  }

  async runScan(_options?: { mode: 'quick' | 'deep' }, onProgress?: (update: ScanProgressUpdate) => void): Promise<RunScanResult> {
    const scan = await this.performScan(onProgress)
    return { scanSession: scan.scanSession, categories: scan.categories, diskSummary: scan.diskSummary }
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
   * READ-ONLY PHASE: this never deletes, trashes, or moves any real file.
   * It simulates the result (removes items from the current in-memory view
   * and records a session) so the existing review/confirm/result UI keeps
   * working end to end. Real cleanup arrives in the Safe Cleanup phase.
   */
  async cleanItems(ids: string[], _mode: CleanMode): Promise<CleanItemsResult> {
    const scan = await this.ensureScanned()
    const idSet = new Set(ids)
    const cleaned = scan.items.filter((item) => idSet.has(item.id))
    const estimatedBytes = cleaned.reduce((sum, item) => sum + item.sizeBytes, 0)
    const beforeUsedBytes = scan.diskSummary.usedBytes

    const categoryTotals = new Map<string, number>()
    for (const item of cleaned) {
      categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.sizeBytes)
    }

    scan.items = scan.items.filter((item) => !idSet.has(item.id))
    scan.categories = recomputeCategoriesAfterRemoval(scan)
    // No bytes were actually freed on disk — usedBytes/freeBytes stay real and unchanged.

    const session: CleanupSession = {
      id: nextId('cleanup'),
      completedAt: new Date().toISOString(),
      estimatedBytes,
      actualBytes: 0,
      itemIds: ids,
      categoryBreakdown: Array.from(categoryTotals.entries()).map(([category, bytes]) => ({
        category: category as CleanupItem['category'],
        bytes,
      })),
      beforeUsedBytes,
      afterUsedBytes: beforeUsedBytes,
      itemCount: cleaned.length,
    }

    this.local.history = [session, ...this.local.history]
    this.local.schedule = { ...this.local.schedule, lastRunAt: session.completedAt }
    this.persistLocal()

    return {
      session,
      diskSummary: scan.diskSummary,
      categories: scan.categories,
      remainingItems: scan.items,
    }
  }

  async excludeItem(id: string): Promise<CleanupItem[]> {
    const scan = await this.ensureScanned()
    const target = scan.items.find((item) => item.id === id)
    if (target && !this.local.exclusions.includes(target.path)) {
      this.local.exclusions = [...this.local.exclusions, target.path]
      this.persistLocal()
    }
    scan.items = scan.items.map((item) => (item.id === id ? { ...item, excluded: true, selected: false } : item))
    return scan.items
  }

  async revealInFinder(path: string): Promise<void> {
    await revealInFinderNative(path)
  }

  /**
   * Real application uninstall is deferred to the Safe Cleanup phase. The
   * Applications screen disables this control entirely in real-data mode, so
   * this is only a defensive no-op fallback (never actually removes an app).
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
    this.local = { settings: DEFAULT_SETTINGS, schedule: DEFAULT_SCHEDULE, history: [], exclusions: [] }
    this.scan = null
    this.persistLocal()
  }
}

function mapAccessState(state: 'accessible' | 'denied' | 'not-found'): PermissionStatus['state'] {
  if (state === 'accessible') return 'granted'
  if (state === 'not-found') return 'not-requested'
  return 'denied'
}

function recomputeCategoriesAfterRemoval(scan: ClassifiedScan) {
  return buildRealCategories(scan.items, scan.applications, scan.diskSummary.usedBytes)
}

export const tauriStorageService = new TauriStorageService()
