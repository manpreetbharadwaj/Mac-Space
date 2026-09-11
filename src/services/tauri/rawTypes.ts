/** Raw shapes returned by src-tauri/src/dto.rs — mirrors the Rust structs exactly. */

export interface RawSystemOverview {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  purgeableBytes: number
  volumeName: string
  homeDir: string
  username: string
}

export interface RawScannedFile {
  name: string
  path: string
  sizeBytes: number
  modifiedMs: number | null
  accessedMs: number | null
  extension: string | null
  root: 'downloads' | 'desktop' | 'documents' | 'system-caches' | 'system-logs'
  duplicateGroup: string | null
}

export interface RawDevItem {
  kind: string
  tool: string
  label: string
  path: string
  sizeBytes: number
  modifiedMs: number | null
}

export interface RawBrowserItem {
  browserId: string
  name: string
  cacheBytes: number
  accessible: boolean
  cachePath: string
}

export interface RawAppItem {
  name: string
  path: string
  sizeBytes: number
  version: string | null
  bundleId: string | null
  lastUsedMs: number | null
}

export interface RawPathAccess {
  path: string
  state: 'accessible' | 'denied' | 'not-found'
}

export interface RawScanWarning {
  path: string
  message: string
}

export interface RawScanProgressEvent {
  phase: string
  label: string
  done: boolean
}

export interface RawFullScanResult {
  overview: RawSystemOverview
  files: RawScannedFile[]
  developer: RawDevItem[]
  browsers: RawBrowserItem[]
  applications: RawAppItem[]
  warnings: RawScanWarning[]
  scannedAtMs: number
}
