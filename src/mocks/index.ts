import type {
  ApplicationItem,
  BrowserProfile,
  CleanupItem,
  CleanupSession,
  DiskSummary,
  PermissionStatus,
  ScanEvent,
  ScanSession,
  ScheduleRule,
  Settings,
  StorageCategory,
  StorageCategoryId,
} from '@/types'
import { allCleanupItems } from './cleanupItems'
import { applications as mockApplications } from './applications'
import { browserProfiles as mockBrowserProfiles } from './browsers'
import { permissions as mockPermissions } from './permissions'
import { cleanupHistory as mockHistory } from './history'
import { scheduleRule as mockScheduleRule, defaultSettings } from './schedule'
import { gb, nextId } from './seed'

export const TOTAL_DISK_BYTES = gb(512)

const CATEGORY_BASELINE_BYTES: Record<StorageCategoryId, number> = {
  developer: gb(70),
  browser: gb(6),
  system: gb(15),
  downloads: gb(2),
  media: gb(55),
  documents: gb(38),
  applications: gb(62),
  other: gb(95.5),
  files: 0,
}

const CATEGORY_LABELS: Record<StorageCategoryId, string> = {
  developer: 'Developer',
  browser: 'Browser',
  applications: 'Applications',
  downloads: 'Downloads',
  files: 'Files',
  system: 'System & Caches',
  documents: 'Documents',
  media: 'Media',
  other: 'Other',
}

const DASHBOARD_CATEGORY_ORDER: StorageCategoryId[] = [
  'developer',
  'applications',
  'media',
  'documents',
  'downloads',
  'browser',
  'system',
  'other',
]

export function buildCategories(items: CleanupItem[], applications: ApplicationItem[]): StorageCategory[] {
  return DASHBOARD_CATEGORY_ORDER.map((id) => {
    const categoryItems = items.filter((item) => item.category === id && !item.excluded)
    const itemBytes = categoryItems.reduce((sum, item) => sum + item.sizeBytes, 0)
    const reclaimableBytes = categoryItems
      .filter((item) => item.safety !== 'red')
      .reduce((sum, item) => sum + item.sizeBytes, 0)

    const appBytes = id === 'applications' ? applications.reduce((sum, app) => sum + app.sizeBytes, 0) : 0
    const appReclaimable =
      id === 'applications'
        ? applications
            .filter((app) => app.usageStatus === 'not-used')
            .reduce((sum, app) => sum + app.associatedCleanupBytes, 0)
        : 0

    return {
      id,
      label: CATEGORY_LABELS[id],
      usedBytes: CATEGORY_BASELINE_BYTES[id] + itemBytes + appBytes,
      reclaimableBytes: reclaimableBytes + appReclaimable,
      itemCount: categoryItems.length + (id === 'applications' ? applications.filter((a) => a.usageStatus !== 'active').length : 0),
    }
  })
}

export function buildDiskSummary(categories: StorageCategory[], lastScanAt: string | null): DiskSummary {
  const usedBytes = categories.reduce((sum, cat) => sum + cat.usedBytes, 0)
  const reclaimableBytes = categories.reduce((sum, cat) => sum + cat.reclaimableBytes, 0)
  return {
    totalBytes: TOTAL_DISK_BYTES,
    usedBytes,
    freeBytes: TOTAL_DISK_BYTES - usedBytes,
    purgeableBytes: null,
    reclaimableBytes,
    lastScanAt,
  }
}

export function buildInitialScanSession(items: CleanupItem[]): ScanSession {
  const eligible = items.filter((item) => !item.excluded)
  const safeBytes = eligible.filter((i) => i.safety === 'green').reduce((s, i) => s + i.sizeBytes, 0)
  const reviewBytes = eligible.filter((i) => i.safety === 'orange').reduce((s, i) => s + i.sizeBytes, 0)
  const byCategory = new Map<string, number>()
  for (const item of eligible) {
    if (item.safety === 'red') continue
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.sizeBytes)
  }
  let biggestCategory: StorageCategoryId | null = null
  let biggest = 0
  for (const [category, bytes] of byCategory) {
    if (bytes > biggest) {
      biggest = bytes
      biggestCategory = category as StorageCategoryId
    }
  }
  const now = new Date()
  const startedAt = new Date(now.getTime() - 6 * 60 * 60 * 1000)
  return {
    id: nextId('scan'),
    startedAt: startedAt.toISOString(),
    completedAt: now.toISOString(),
    foundBytes: safeBytes + reviewBytes,
    safeBytes,
    reviewBytes,
    status: 'completed',
    biggestCategory,
  }
}

export interface SeedData {
  cleanupItems: CleanupItem[]
  applications: ApplicationItem[]
  browserProfiles: BrowserProfile[]
  permissions: PermissionStatus[]
  history: CleanupSession[]
  schedule: ScheduleRule
  settings: Settings
  scanSession: ScanSession
  scanEvents: ScanEvent[]
}

export function createSeedData(): SeedData {
  const cleanupItems = allCleanupItems
  const applications = mockApplications
  const scanSession = buildInitialScanSession(cleanupItems)
  return {
    cleanupItems,
    applications,
    browserProfiles: mockBrowserProfiles,
    permissions: mockPermissions,
    history: mockHistory,
    schedule: mockScheduleRule,
    settings: defaultSettings,
    scanSession,
    scanEvents: [],
  }
}

export { CATEGORY_LABELS, DASHBOARD_CATEGORY_ORDER }
