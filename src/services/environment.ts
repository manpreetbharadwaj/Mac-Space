import { isTauri } from '@tauri-apps/api/core'

/**
 * True when running inside the Tauri desktop shell (native window backed by
 * real macOS APIs). False in the plain browser prototype (`npm run dev`),
 * where the mock service is used instead.
 */
export function isTauriRuntime(): boolean {
  try {
    return isTauri()
  } catch {
    return false
  }
}

export type DataSource = 'mock' | 'tauri'

export const dataSource: DataSource = isTauriRuntime() ? 'tauri' : 'mock'
