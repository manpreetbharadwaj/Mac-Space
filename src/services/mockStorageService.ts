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
import { buildCategories, buildDiskSummary, buildInitialScanSession, createSeedData } from '@/mocks'
import { nextId } from '@/mocks/seed'
import type { CleanItemsResult, CleanMode, RunScanResult, StorageService } from './storageServiceTypes'

const STORAGE_KEY = 'mac-storage-manager:v1'

interface PersistedState {
  cleanupItems: CleanupItem[]
  applications: ApplicationItem[]
  browserProfiles: BrowserProfile[]
  permissions: PermissionStatus[]
  history: CleanupSession[]
  schedule: ScheduleRule
  settings: Settings
  scanSession: ScanSession
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PersistedState
  } catch {
    // fall through to fresh seed
  }
  return createSeedData()
}

export class MockStorageService implements StorageService {
  private state: PersistedState = loadPersisted()

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // localStorage unavailable — demo continues without persistence
    }
  }

  /**
   * `settings.exclusions` is the single source of truth for what's excluded
   * — never a stale flag baked into the stored item. That means removing a
   * path from Settings → Exclusions makes the item eligible again on the
   * very next read, with no separate "un-exclude" bookkeeping required.
   */
  private itemsView(): CleanupItem[] {
    const excludedPaths = new Set(this.state.settings.exclusions)
    return this.state.cleanupItems.map((item) =>
      excludedPaths.has(item.path)
        ? { ...item, excluded: true, selected: false }
        : { ...item, excluded: false },
    )
  }

  private categories(): StorageCategory[] {
    return buildCategories(this.itemsView(), this.state.applications)
  }

  private diskSummary(): DiskSummary {
    return buildDiskSummary(this.categories(), this.state.scanSession.completedAt)
  }

  async getDiskSummary(): Promise<DiskSummary> {
    await delay(120)
    return this.diskSummary()
  }

  async getCategories(): Promise<StorageCategory[]> {
    await delay(120)
    return this.categories()
  }

  async getCleanupItems(): Promise<CleanupItem[]> {
    await delay(150)
    return this.itemsView()
  }

  async getScanSession(): Promise<ScanSession> {
    await delay(100)
    return this.state.scanSession
  }

  async runScan(): Promise<RunScanResult> {
    await delay(300)
    const scanSession = buildInitialScanSession(this.itemsView())
    this.state.scanSession = scanSession
    this.persist()
    return { scanSession, categories: this.categories(), diskSummary: this.diskSummary() }
  }

  async getApplications(): Promise<ApplicationItem[]> {
    await delay(150)
    return this.state.applications
  }

  async getBrowserProfiles(): Promise<BrowserProfile[]> {
    await delay(120)
    return this.state.browserProfiles
  }

  async cleanItems(ids: string[], mode: CleanMode): Promise<CleanItemsResult> {
    await delay(600)
    const idSet = new Set(ids)
    const cleaned = this.itemsView().filter((item) => idSet.has(item.id))
    const estimatedBytes = cleaned.reduce((sum, item) => sum + item.sizeBytes, 0)

    // Trash-based cleanup differs slightly from the estimate, like a real filesystem rescan would.
    // Permanent deletion reports the exact size since nothing lingers in the Trash to reconcile.
    const variance = mode === 'trash' ? 0.93 + ((ids.length * 7) % 11) / 100 : 1
    const actualBytes = Math.round(estimatedBytes * variance)

    const beforeUsedBytes = this.diskSummary().usedBytes

    const categoryTotals = new Map<string, number>()
    for (const item of cleaned) {
      categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.sizeBytes)
    }

    this.state.cleanupItems = this.state.cleanupItems.filter((item) => !idSet.has(item.id))

    const session: CleanupSession = {
      id: nextId('cleanup'),
      completedAt: new Date().toISOString(),
      estimatedBytes,
      actualBytes,
      itemIds: ids,
      categoryBreakdown: Array.from(categoryTotals.entries()).map(([category, bytes]) => ({
        category: category as CleanupItem['category'],
        bytes,
      })),
      beforeUsedBytes,
      afterUsedBytes: beforeUsedBytes - actualBytes,
      itemCount: cleaned.length,
    }

    this.state.history = [session, ...this.state.history]
    this.state.schedule = { ...this.state.schedule, lastRunAt: session.completedAt }
    this.persist()

    return {
      session,
      diskSummary: this.diskSummary(),
      categories: this.categories(),
      remainingItems: this.itemsView(),
    }
  }

  async excludeItem(id: string): Promise<CleanupItem[]> {
    await delay(150)
    const target = this.state.cleanupItems.find((item) => item.id === id)
    if (target && !this.state.settings.exclusions.includes(target.path)) {
      this.state.settings = {
        ...this.state.settings,
        exclusions: [...this.state.settings.exclusions, target.path],
      }
    }
    this.persist()
    return this.itemsView()
  }

  async revealInFinder(_path: string): Promise<void> {
    await delay(200)
  }

  async uninstallApp(id: string): Promise<ApplicationItem[]> {
    await delay(500)
    this.state.applications = this.state.applications.filter((app) => app.id !== id)
    this.persist()
    return this.state.applications
  }

  async getPermissions(): Promise<PermissionStatus[]> {
    await delay(120)
    return this.state.permissions
  }

  async requestPermission(category: PermissionStatus['category']): Promise<PermissionStatus[]> {
    await delay(400)
    this.state.permissions = this.state.permissions.map((permission) =>
      permission.category === category ? { ...permission, state: 'granted' } : permission,
    )
    this.persist()
    return this.state.permissions
  }

  async getSchedule(): Promise<ScheduleRule> {
    await delay(120)
    return this.state.schedule
  }

  async saveSchedule(rule: ScheduleRule): Promise<ScheduleRule> {
    await delay(250)
    this.state.schedule = rule
    this.persist()
    return this.state.schedule
  }

  async getHistory(): Promise<CleanupSession[]> {
    await delay(150)
    return this.state.history
  }

  async getSettings(): Promise<Settings> {
    await delay(100)
    return this.state.settings
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    await delay(200)
    this.state.settings = settings
    this.persist()
    return this.state.settings
  }

  async resetDemoData(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY)
    this.state = createSeedData()
    this.persist()
  }
}

export const mockStorageService = new MockStorageService()
