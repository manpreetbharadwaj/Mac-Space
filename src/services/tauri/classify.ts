import type {
  ApplicationItem,
  BrowserProfile,
  CleanupItem,
  DeveloperTool,
  DiskSummary,
  FileKind,
  SafetyLevel,
  ScanSession,
  StorageCategory,
  StorageCategoryId,
  UsageStatus,
} from '@/types'
import { formatRelativeDays } from '@/lib/format'
import { buildInitialScanSession, CATEGORY_LABELS, DASHBOARD_CATEGORY_ORDER } from '@/mocks'
import type {
  RawAppItem,
  RawBrowserItem,
  RawDevItem,
  RawFullScanResult,
  RawScannedFile,
} from './rawTypes'

const DAY_MS = 1000 * 60 * 60 * 24

function ageDaysFrom(ms: number | null, now: number): number {
  if (ms === null) return 0
  return Math.max(0, Math.floor((now - ms) / DAY_MS))
}

function lastUsedLabelFrom(ms: number | null, now: number): string {
  if (ms === null) return 'Unknown'
  return formatRelativeDays(ageDaysFrom(ms, now))
}

/** Names/keywords that make us treat an item as Protected regardless of any other rule. */
const PROTECTED_KEYWORDS = [
  'backup',
  'keychain',
  '1password',
  'wallet',
  '.key',
  'private key',
  'passwords',
]

function looksSensitive(name: string, path: string): boolean {
  const haystack = `${name} ${path}`.toLowerCase()
  return PROTECTED_KEYWORDS.some((kw) => haystack.includes(kw))
}

// ---------------------------------------------------------------------------
// Developer tooling
// ---------------------------------------------------------------------------

interface DevCopy {
  name: string
  source: string
  safety: SafetyLevel
  whyItExists: string
  whatHappensIfCleaned: string
}

const DEV_COPY: Record<string, DevCopy> = {
  'xcode-derived-data': {
    name: 'Xcode DerivedData',
    source: 'Xcode',
    safety: 'green',
    whyItExists: 'Intermediate build products Xcode regenerates automatically on the next build.',
    whatHappensIfCleaned: 'Your next build will take longer while Xcode re-indexes and recompiles.',
  },
  'xcode-archives': {
    name: 'Xcode Archives',
    source: 'Xcode',
    safety: 'orange',
    whyItExists: 'Archived builds created for App Store submissions and TestFlight distribution.',
    whatHappensIfCleaned: 'You will lose the ability to re-export dSYMs or re-submit this exact build.',
  },
  'xcode-device-support-ios': {
    name: 'iOS Device Support',
    source: 'Xcode',
    safety: 'green',
    whyItExists: 'Debug symbols cached for physical iOS devices you connected in the past.',
    whatHappensIfCleaned: 'Xcode re-downloads device support the next time you connect that device.',
  },
  'xcode-device-support-watchos': {
    name: 'watchOS Device Support',
    source: 'Xcode',
    safety: 'green',
    whyItExists: 'Debug symbols cached for paired Apple Watches you tested with in the past.',
    whatHappensIfCleaned: 'Xcode re-downloads device support the next time you connect that device.',
  },
  'xcode-simulator-caches': {
    name: 'Simulator Caches',
    source: 'Xcode',
    safety: 'green',
    whyItExists: 'Cached data the iOS/watchOS Simulator rebuilds automatically as needed.',
    whatHappensIfCleaned: 'No impact — the simulator recreates its cache automatically.',
  },
  'xcode-simulator-devices': {
    name: 'Simulator Devices',
    source: 'Xcode',
    safety: 'orange',
    whyItExists: 'Storage used by every simulated iOS/watchOS/tvOS device, including any test app data installed on them.',
    whatHappensIfCleaned: 'Simulator devices and any app data installed on them will need to be recreated.',
  },
  'npm-cache': {
    name: 'npm cache',
    source: 'Node.js',
    safety: 'green',
    whyItExists: 'Downloaded package tarballs npm keeps so future installs can skip the network.',
    whatHappensIfCleaned: 'Future npm installs re-download packages instead of using the local cache.',
  },
  'yarn-cache': {
    name: 'Yarn cache',
    source: 'Node.js',
    safety: 'green',
    whyItExists: 'Downloaded package cache Yarn keeps across all your projects.',
    whatHappensIfCleaned: 'Installs fall back to the network; already-installed projects are unaffected.',
  },
  'pnpm-store': {
    name: 'pnpm store',
    source: 'Node.js',
    safety: 'green',
    whyItExists: 'Shared package store pnpm keeps across all your projects.',
    whatHappensIfCleaned: 'Installs fall back to the network; already-installed projects are unaffected.',
  },
  'metro-cache': {
    name: 'Metro bundler cache',
    source: 'React Native',
    safety: 'green',
    whyItExists: 'Temporary bundler cache Metro (React Native) writes to your system temp folder.',
    whatHappensIfCleaned: 'No impact — Metro rebuilds its cache automatically on the next bundle.',
  },
  'gradle-caches': {
    name: 'Gradle caches',
    source: 'Android',
    safety: 'green',
    whyItExists: 'Downloaded dependencies and build metadata shared across Android/Gradle projects.',
    whatHappensIfCleaned: 'Gradle re-downloads and re-resolves dependencies on the next build (slower first build).',
  },
  'android-avd': {
    name: 'Android emulator images',
    source: 'Android',
    safety: 'orange',
    whyItExists: 'Virtual device images and any data installed on your Android emulators.',
    whatHappensIfCleaned: 'You will need to re-create any emulator you use again, and any test app data on them is lost.',
  },
  'cocoapods-cache': {
    name: 'CocoaPods cache',
    source: 'CocoaPods',
    safety: 'green',
    whyItExists: 'Downloaded pod specs and sources cached across all your iOS projects.',
    whatHappensIfCleaned: '"pod install" re-downloads pods the next time it runs.',
  },
}

const TOOL_MAP: Record<string, DeveloperTool> = {
  xcode: 'xcode',
  node: 'node',
  android: 'android',
  cocoapods: 'cocoapods',
  docker: 'docker',
  general: 'general',
}

export function classifyDeveloperItems(items: RawDevItem[], now: number): CleanupItem[] {
  return items.map((item) => {
    const copy = DEV_COPY[item.kind] ?? {
      name: item.label,
      source: item.tool,
      safety: 'orange' as SafetyLevel,
      whyItExists: 'Storage used by a developer tool detected on this Mac.',
      whatHappensIfCleaned: 'Review before removing — the tool may need to regenerate this data.',
    }
    const sensitive = looksSensitive(item.label, item.path)
    return {
      id: `dev:${item.path}`,
      name: copy.name,
      category: 'developer',
      source: copy.source,
      tool: TOOL_MAP[item.tool] ?? 'general',
      path: item.path,
      sizeBytes: item.sizeBytes,
      ageDays: ageDaysFrom(item.modifiedMs, now),
      lastUsedLabel: lastUsedLabelFrom(item.modifiedMs, now),
      safety: sensitive ? 'red' : copy.safety,
      whyItExists: copy.whyItExists,
      whatHappensIfCleaned: sensitive
        ? 'This item’s name suggests it may contain sensitive data. Protected by default — review manually in Finder.'
        : copy.whatHappensIfCleaned,
      selected: false,
      excluded: false,
    }
  })
}

// ---------------------------------------------------------------------------
// Browsers
// ---------------------------------------------------------------------------

const BROWSER_ACCENTS: Record<string, string> = {
  safari: '#0ea5e9',
  chrome: '#f59e0b',
  edge: '#0078d4',
  firefox: '#ff7139',
}

export function classifyBrowserProfiles(items: RawBrowserItem[]): BrowserProfile[] {
  return items.map((item) => ({
    id: item.browserId as BrowserProfile['id'],
    name: item.name,
    accent: BROWSER_ACCENTS[item.browserId] ?? '#64748b',
    cacheBytes: item.cacheBytes,
    cookiesBytes: 0,
    // We deliberately never read passwords, bookmarks, autofill, or extensions —
    // `null` means "not scanned" so the UI can say that honestly instead of "0".
    passwordsCount: null,
    bookmarksCount: null,
    extensionsCount: null,
    autofillEntries: null,
    lastCleanedLabel: 'Not cleaned via this app yet',
  }))
}

export function classifyBrowserCleanupItems(items: RawBrowserItem[], _now: number): CleanupItem[] {
  return items
    .filter((item) => item.accessible && item.cacheBytes > 0)
    .map((item) => ({
      id: `browser:${item.browserId}`,
      name: `${item.name} cache & temporary files`,
      category: 'browser',
      source: item.name,
      browserId: item.browserId as CleanupItem['browserId'],
      path: item.cachePath,
      sizeBytes: item.cacheBytes,
      // Caches are continuously rewritten, so there's no single meaningful
      // "last modified" date for the aggregate folder — it's always current.
      ageDays: 0,
      lastUsedLabel: 'Updated recently',
      safety: 'green',
      whyItExists: 'Cached site assets and rendering data the browser rebuilds automatically.',
      whatHappensIfCleaned: 'Sites reload full assets on your next visit — passwords, cookies, and bookmarks are untouched.',
      selected: false,
      excluded: false,
    }))
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

const ACCENT_PALETTE = ['#3b82f6', '#a855f7', '#f59e0b', '#22c55e', '#ec4899', '#06b6d4', '#ef4444', '#64748b']

function accentForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return ACCENT_PALETTE[hash % ACCENT_PALETTE.length]
}

function usageStatusFor(daysAgo: number | null): UsageStatus {
  if (daysAgo === null) return 'unknown'
  if (daysAgo <= 7) return 'active'
  if (daysAgo <= 60) return 'infrequent'
  return 'not-used'
}

export function classifyApplications(
  items: RawAppItem[],
  systemCacheFiles: RawScannedFile[],
  now: number,
): ApplicationItem[] {
  // Best-effort, honest correlation: some app support/cache folders are named
  // after the app's bundle identifier. We only attribute size we actually
  // scanned — nothing here is estimated or invented.
  const cacheByBundleId = new Map<string, number>()
  for (const file of systemCacheFiles) {
    cacheByBundleId.set(file.name.toLowerCase(), file.sizeBytes)
  }

  return items.map((item) => {
    const daysAgo = item.lastUsedMs === null ? null : ageDaysFrom(item.lastUsedMs, now)
    const associated = item.bundleId ? cacheByBundleId.get(item.bundleId.toLowerCase()) ?? 0 : 0

    return {
      id: item.bundleId ?? item.path,
      name: item.name,
      sizeBytes: item.sizeBytes,
      lastUsedAt: item.lastUsedMs === null ? null : new Date(item.lastUsedMs).toISOString(),
      lastUsedDaysAgo: daysAgo,
      usageStatus: usageStatusFor(daysAgo),
      associatedCleanupBytes: associated,
      accent: accentForName(item.name),
      initial: item.name.charAt(0).toUpperCase() || '?',
    }
  })
}

// ---------------------------------------------------------------------------
// Files (Downloads / Desktop / Documents / system caches & logs)
// ---------------------------------------------------------------------------

const LARGE_THRESHOLD_BYTES = 500 * 1000 * 1000
const OLD_THRESHOLD_DAYS = 180
const INSTALLER_EXTENSIONS = new Set(['dmg', 'pkg'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z'])
const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'heic', 'gif', 'mov', 'mp4', 'm4v', 'avi', 'mkv', 'mp3', 'wav', 'aac',
])

function categoryForFile(root: RawScannedFile['root'], extension: string | null): StorageCategoryId {
  if (root === 'system-caches' || root === 'system-logs') return 'system'
  if (root === 'downloads') return 'downloads'
  if (extension && MEDIA_EXTENSIONS.has(extension)) return 'media'
  return 'documents'
}

function classifyFileKind(
  file: RawScannedFile,
  ageDays: number,
): { fileKind: FileKind | undefined; safety: SafetyLevel; why: string; consequence: string } | null {
  const ext = file.extension ?? ''

  if (file.duplicateGroup) {
    return {
      fileKind: 'duplicate',
      safety: 'orange',
      why: 'This file appears to match another file we found, by size and a content sample from its start and end.',
      consequence: 'Only this copy would be affected — nothing else is touched, and this is a candidate match, not a guaranteed exact duplicate.',
    }
  }
  if (INSTALLER_EXTENSIONS.has(ext)) {
    return {
      fileKind: 'installer',
      safety: 'green',
      why: 'An installer downloaded from the internet.',
      consequence: 'Re-download the installer if you need to reinstall this software.',
    }
  }
  if (ARCHIVE_EXTENSIONS.has(ext)) {
    return {
      fileKind: 'archive',
      safety: 'green',
      why: 'A compressed archive.',
      consequence: 'If you already extracted its contents elsewhere, the archive itself is usually safe to remove.',
    }
  }
  if (file.sizeBytes >= LARGE_THRESHOLD_BYTES) {
    return {
      fileKind: 'large',
      safety: 'orange',
      why: "A large file we found in your files — we could not determine a more specific type.",
      consequence: 'This is your file — review it before removing anything.',
    }
  }
  if (ageDays >= OLD_THRESHOLD_DAYS) {
    return {
      fileKind: 'old',
      safety: 'orange',
      why: `Not modified in over ${OLD_THRESHOLD_DAYS} days.`,
      consequence: 'This is your file — review it before removing anything.',
    }
  }
  if (file.root === 'downloads') {
    return {
      fileKind: 'download',
      safety: 'orange',
      why: 'A file sitting in your Downloads folder.',
      consequence: 'Review before removing.',
    }
  }
  return null
}

export function classifyFiles(files: RawScannedFile[], now: number): CleanupItem[] {
  const items: CleanupItem[] = []

  for (const file of files) {
    const ageDays = ageDaysFrom(file.modifiedMs, now)
    const sensitive = looksSensitive(file.name, file.path)

    if (file.root === 'system-caches' || file.root === 'system-logs') {
      items.push({
        id: `file:${file.path}`,
        name: file.name,
        category: 'system',
        source: 'macOS',
        path: file.path,
        sizeBytes: file.sizeBytes,
        ageDays,
        lastUsedLabel: lastUsedLabelFrom(file.modifiedMs, now),
        safety: sensitive ? 'red' : 'green',
        whyItExists:
          file.root === 'system-logs'
            ? 'Log files an app or macOS wrote automatically.'
            : 'Cache data an app or macOS created automatically to speed up repeat launches.',
        whatHappensIfCleaned: sensitive
          ? 'This item’s name suggests it may be sensitive — protected by default.'
          : 'No impact — regenerated automatically as needed.',
        selected: false,
        excluded: false,
      })
      continue
    }

    const classification = classifyFileKind(file, ageDays)
    if (!classification && !sensitive) continue // not remarkable enough to surface

    const category = categoryForFile(file.root, file.extension)

    items.push({
      id: `file:${file.path}`,
      name: file.name,
      category,
      source: file.root.charAt(0).toUpperCase() + file.root.slice(1),
      fileKind: classification?.fileKind,
      path: file.path,
      sizeBytes: file.sizeBytes,
      ageDays,
      lastUsedLabel: lastUsedLabelFrom(file.modifiedMs, now),
      safety: sensitive ? 'red' : classification?.safety ?? 'orange',
      whyItExists: sensitive
        ? "This item's name suggests it may contain sensitive or important data."
        : classification?.why ?? 'A file found during scanning.',
      whatHappensIfCleaned: sensitive
        ? 'Protected by default — review manually in Finder before ever considering removal.'
        : classification?.consequence ?? 'Review before removing.',
      selected: false,
      excluded: false,
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Aggregation: categories + disk summary, honestly derived from real data
// ---------------------------------------------------------------------------

export function buildRealCategories(
  items: CleanupItem[],
  applications: ApplicationItem[],
  totalUsedBytes: number,
): StorageCategory[] {
  const scannedByCategory = new Map<StorageCategoryId, { used: number; reclaimable: number; count: number }>()

  for (const item of items) {
    if (item.excluded) continue
    const entry = scannedByCategory.get(item.category) ?? { used: 0, reclaimable: 0, count: 0 }
    entry.used += item.sizeBytes
    if (item.safety !== 'red') entry.reclaimable += item.sizeBytes
    entry.count += 1
    scannedByCategory.set(item.category, entry)
  }

  const appsUsed = applications.reduce((sum, app) => sum + app.sizeBytes, 0)
  scannedByCategory.set('applications', {
    used: appsUsed,
    reclaimable: applications
      .filter((a) => a.usageStatus === 'not-used')
      .reduce((sum, a) => sum + a.associatedCleanupBytes, 0),
    count: applications.length,
  })

  const accountedFor = Array.from(scannedByCategory.values()).reduce((sum, v) => sum + v.used, 0)
  const otherUsed = Math.max(0, totalUsedBytes - accountedFor)

  return DASHBOARD_CATEGORY_ORDER.map((id) => {
    if (id === 'other') {
      const existing = scannedByCategory.get('other')
      return {
        id,
        label: CATEGORY_LABELS[id],
        usedBytes: otherUsed + (existing?.used ?? 0),
        reclaimableBytes: existing?.reclaimable ?? 0,
        itemCount: existing?.count ?? 0,
      }
    }
    const entry = scannedByCategory.get(id)
    return {
      id,
      label: CATEGORY_LABELS[id],
      usedBytes: entry?.used ?? 0,
      reclaimableBytes: entry?.reclaimable ?? 0,
      itemCount: entry?.count ?? 0,
    }
  })
}

export function buildRealDiskSummary(
  categories: StorageCategory[],
  totalBytes: number,
  usedBytes: number,
  freeBytes: number,
  purgeableBytes: number,
  lastScanAt: string | null,
): DiskSummary {
  const reclaimableBytes = categories.reduce((sum, c) => sum + c.reclaimableBytes, 0)
  return { totalBytes, usedBytes, freeBytes, purgeableBytes, reclaimableBytes, lastScanAt }
}

export interface ClassifiedScan {
  items: CleanupItem[]
  applications: ApplicationItem[]
  browserProfiles: BrowserProfile[]
  categories: StorageCategory[]
  diskSummary: DiskSummary
  scanSession: ScanSession
  warnings: RawFullScanResult['warnings']
  overview: RawFullScanResult['overview']
}

export function classifyFullScan(raw: RawFullScanResult): ClassifiedScan {
  const now = Date.now()

  const developerItems = classifyDeveloperItems(raw.developer, now)
  const browserCleanupItems = classifyBrowserCleanupItems(raw.browsers, now)
  const fileItems = classifyFiles(raw.files, now)
  const items = [...developerItems, ...browserCleanupItems, ...fileItems]

  const applications = classifyApplications(
    raw.applications,
    raw.files.filter((f) => f.root === 'system-caches'),
    now,
  )
  const browserProfiles = classifyBrowserProfiles(raw.browsers)

  const categories = buildRealCategories(items, applications, raw.overview.usedBytes)
  const lastScanAt = new Date(raw.scannedAtMs).toISOString()
  const diskSummary = buildRealDiskSummary(
    categories,
    raw.overview.totalBytes,
    raw.overview.usedBytes,
    raw.overview.freeBytes,
    raw.overview.purgeableBytes,
    lastScanAt,
  )
  const scanSession = buildInitialScanSession(items)

  return {
    items,
    applications,
    browserProfiles,
    categories,
    diskSummary,
    scanSession,
    warnings: raw.warnings,
    overview: raw.overview,
  }
}
