import { create } from 'zustand'
import type {
  ApplicationItem,
  BrowserProfile,
  CleanupFailure,
  CleanupItem,
  CleanupSession,
  DiskSummary,
  PermissionStatus,
  ScanSession,
  ScheduleRule,
  Settings,
  StorageCategory,
  StorageCategoryId,
} from '@/types'
import { storageService, type CleanMode } from '@/services/storageService'
import type { CleanupProgressUpdate, ScanProgressUpdate } from '@/services/storageServiceTypes'
import { dataSource, type DataSource } from '@/services/environment'

export interface Toast {
  id: string
  message: string
  tone: 'default' | 'success' | 'warning'
}

export interface LastCleanupResult {
  actualBytes: number
  itemCount: number
  successCount: number
  failureCount: number
  failures: CleanupFailure[]
  freedOnDiskBytes?: number
}

interface AppState {
  ready: boolean
  dataSource: DataSource
  diskSummary: DiskSummary | null
  categories: StorageCategory[]
  cleanupItems: CleanupItem[]
  applications: ApplicationItem[]
  browserProfiles: BrowserProfile[]
  permissions: PermissionStatus[]
  schedule: ScheduleRule | null
  settings: Settings | null
  history: CleanupSession[]
  scanSession: ScanSession | null
  scanning: boolean
  cleaning: boolean
  selectedIds: Set<string>
  toasts: Toast[]
  lastCleanupResult: LastCleanupResult | null

  init: () => Promise<void>
  runScan: (onProgress?: (update: ScanProgressUpdate) => void) => Promise<void>
  toggleSelect: (id: string) => void
  selectIds: (ids: string[]) => void
  deselectIds: (ids: string[]) => void
  clearSelection: () => void
  smartSelect: () => void
  cleanSelected: (mode: CleanMode, onProgress?: (update: CleanupProgressUpdate) => void) => Promise<void>
  excludeItem: (id: string) => Promise<void>
  revealInFinder: (path: string) => Promise<void>
  uninstallApp: (id: string) => Promise<void>
  saveSchedule: (rule: ScheduleRule) => Promise<void>
  saveSettings: (settings: Settings) => Promise<void>
  requestPermission: (category: PermissionStatus['category']) => Promise<void>
  resetDemoData: () => Promise<void>
  pushToast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
}

let toastCounter = 0

async function refreshCore(set: (partial: Partial<AppState>) => void) {
  const [diskSummary, categories, cleanupItems] = await Promise.all([
    storageService.getDiskSummary(),
    storageService.getCategories(),
    storageService.getCleanupItems(),
  ])
  set({ diskSummary, categories, cleanupItems })
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  dataSource,
  diskSummary: null,
  categories: [],
  cleanupItems: [],
  applications: [],
  browserProfiles: [],
  permissions: [],
  schedule: null,
  settings: null,
  history: [],
  scanSession: null,
  scanning: false,
  cleaning: false,
  selectedIds: new Set(),
  toasts: [],
  lastCleanupResult: null,

  init: async () => {
    const [diskSummary, categories, cleanupItems, applications, browserProfiles, permissions, schedule, settings, history, scanSession] =
      await Promise.all([
        storageService.getDiskSummary(),
        storageService.getCategories(),
        storageService.getCleanupItems(),
        storageService.getApplications(),
        storageService.getBrowserProfiles(),
        storageService.getPermissions(),
        storageService.getSchedule(),
        storageService.getSettings(),
        storageService.getHistory(),
        storageService.getScanSession(),
      ])
    set({
      diskSummary,
      categories,
      cleanupItems,
      applications,
      browserProfiles,
      permissions,
      schedule,
      settings,
      history,
      scanSession,
      ready: true,
    })
  },

  runScan: async (onProgress) => {
    set({ scanning: true })
    const result = await storageService.runScan(undefined, onProgress)
    set({
      scanning: false,
      scanSession: result.scanSession,
      categories: result.categories,
      diskSummary: result.diskSummary,
      selectedIds: new Set(),
    })
  },

  toggleSelect: (id) => {
    const next = new Set(get().selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({ selectedIds: next })
  },

  selectIds: (ids) => {
    const next = new Set(get().selectedIds)
    for (const id of ids) next.add(id)
    set({ selectedIds: next })
  },

  deselectIds: (ids) => {
    const next = new Set(get().selectedIds)
    for (const id of ids) next.delete(id)
    set({ selectedIds: next })
  },

  clearSelection: () => set({ selectedIds: new Set() }),

  smartSelect: () => {
    const greenIds = get()
      .cleanupItems.filter((item) => item.safety === 'green' && !item.excluded)
      .map((item) => item.id)
    set({ selectedIds: new Set(greenIds) })
  },

  cleanSelected: async (mode, onProgress) => {
    const ids = Array.from(get().selectedIds)
    if (ids.length === 0) return
    set({ cleaning: true })
    const result = await storageService.cleanItems(ids, mode, onProgress)

    // Mock mode never reports successIds/failures (everything always
    // succeeds there) — default to "all requested ids succeeded" so the
    // selection-clearing logic below behaves identically to before.
    const successIds = result.successIds ?? ids
    const failures = result.failures ?? []

    const remainingSelection = new Set(get().selectedIds)
    for (const id of successIds) remainingSelection.delete(id)
    // Failed ids are deliberately left in the selection — they stay visible
    // and selected so the user can see and retry them.

    set({
      cleaning: false,
      cleanupItems: result.remainingItems,
      diskSummary: result.diskSummary,
      categories: result.categories,
      history: [result.session, ...get().history],
      selectedIds: remainingSelection,
      lastCleanupResult: {
        actualBytes: result.session.actualBytes,
        itemCount: result.session.itemCount,
        successCount: result.session.successCount ?? result.session.itemCount,
        failureCount: result.session.failureCount ?? 0,
        failures,
        freedOnDiskBytes: result.session.freedOnDiskBytes,
      },
    })

    if (failures.length > 0) {
      get().pushToast(
        `Moved ${successIds.length} item${successIds.length === 1 ? '' : 's'} to Trash — ${failures.length} failed.`,
        'warning',
      )
    } else {
      get().pushToast(
        `Cleaned ${result.session.itemCount} item${result.session.itemCount === 1 ? '' : 's'} — space reclaimed.`,
        'success',
      )
    }
  },

  excludeItem: async (id) => {
    const cleanupItems = await storageService.excludeItem(id)
    const next = new Set(get().selectedIds)
    next.delete(id)
    set({ cleanupItems, selectedIds: next })
    // Excluding an item persists into settings.exclusions (the single source
    // of truth — see MockStorageService/TauriStorageService) — refetch
    // settings too, not just categories/items, so the Settings screen shows
    // the new exclusion immediately instead of only after a reload.
    const settings = await storageService.getSettings()
    set({ settings })
    await refreshCore(set)
    get().pushToast('Item excluded — it will no longer appear in recommendations.', 'default')
  },

  revealInFinder: async (path) => {
    await storageService.revealInFinder(path)
    get().pushToast(`Revealed "${path}" in Finder (simulated).`, 'default')
  },

  uninstallApp: async (id) => {
    const applications = await storageService.uninstallApp(id)
    set({ applications })
    await refreshCore(set)
    get().pushToast('App uninstalled (simulated) — no real application was changed.', 'success')
  },

  saveSchedule: async (rule) => {
    const schedule = await storageService.saveSchedule(rule)
    set({ schedule })
    get().pushToast('Schedule saved.', 'success')
  },

  saveSettings: async (settings) => {
    const saved = await storageService.saveSettings(settings)
    set({ settings: saved })
    // Exclusions live inside `settings` — re-fetch items/categories/disk
    // summary so adding or removing one is reflected immediately, without
    // requiring a rescan.
    await refreshCore(set)
  },

  requestPermission: async (category) => {
    const permissions = await storageService.requestPermission(category)
    set({ permissions })
    get().pushToast('Permission granted (simulated).', 'success')
  },

  resetDemoData: async () => {
    await storageService.resetDemoData()
    await get().init()
    get().pushToast('Demo data reset.', 'default')
  },

  pushToast: (message, tone = 'default') => {
    toastCounter += 1
    const id = `toast-${toastCounter}`
    set({ toasts: [...get().toasts, { id, message, tone }] })
    setTimeout(() => get().dismissToast(id), 3600)
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export function selectItemsByCategory(items: CleanupItem[], category: StorageCategoryId) {
  return items.filter((item) => item.category === category && !item.excluded)
}

export function selectTotalBytes(items: CleanupItem[], ids: Set<string>) {
  return items.filter((item) => ids.has(item.id)).reduce((sum, item) => sum + item.sizeBytes, 0)
}
