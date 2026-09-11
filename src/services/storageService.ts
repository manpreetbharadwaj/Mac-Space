import { isTauriRuntime } from './environment'
import { mockStorageService } from './mockStorageService'
import { tauriStorageService } from './tauriStorageService'

export type { CleanItemsResult, CleanMode, RunScanResult, StorageService } from './storageServiceTypes'

/**
 * Selects the real implementation when running inside the Tauri desktop
 * shell, or the mock implementation in the plain browser prototype. Every
 * screen and the Zustand store depend only on this — never on Mock/Tauri
 * directly — so this is the one place that needs to change to add a future
 * implementation (see PRD "Tauri Integration Contract").
 */
export const storageService = isTauriRuntime() ? tauriStorageService : mockStorageService
