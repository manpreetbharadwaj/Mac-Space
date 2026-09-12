import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { isTauriRuntime } from './environment'

export interface NativeUpdateInfo {
  version: string
  date?: string
  body?: string
}

/**
 * Thin wrapper around @tauri-apps/plugin-updater + plugin-process so the rest
 * of the app never imports the Tauri updater APIs directly. Every function is
 * a safe no-op outside the real desktop shell (the browser mock prototype),
 * matching the pattern in services/tauri/bridge.ts.
 */
let pendingUpdate: Update | null = null

/**
 * Asks the Tauri updater to check the configured manifest endpoint (see
 * `plugins.updater.endpoints` in src-tauri/tauri.conf.json). Returns null
 * outside the desktop shell, when already up to date, or when the check
 * itself fails (e.g. offline) — the thrown error case must be treated as
 * "network issue", never as "app is unsupported".
 */
export async function checkNativeUpdate(): Promise<NativeUpdateInfo | null> {
  if (!isTauriRuntime()) return null
  const update = await check()
  if (!update) {
    pendingUpdate = null
    return null
  }
  pendingUpdate = update
  return { version: update.version, date: update.date, body: update.body }
}

export interface UpdateInstallProgress {
  phase: 'downloading' | 'installing'
  /** 0-100, or null when the server didn't send a content-length to compute a percentage from. */
  percent: number | null
}

/**
 * Downloads and installs the update found by the most recent
 * checkNativeUpdate() call. The plugin's downloadAndInstall() covers both
 * steps in one call — the 'Finished' download event is our only signal that
 * download has completed and the (comparatively instant) native install/
 * signature-verification step has begun, so we report 'installing' there.
 * Throws on failure so the caller can surface a retry affordance — never
 * leaves partial state to clean up, since the plugin only swaps the app
 * bundle after a full, signature-verified download.
 */
export async function downloadAndInstallNativeUpdate(onEvent?: (progress: UpdateInstallProgress) => void): Promise<void> {
  if (!pendingUpdate) {
    throw new Error('No update is available to install. Check for updates again.')
  }
  let totalBytes = 0
  let downloadedBytes = 0
  await pendingUpdate.downloadAndInstall((progress) => {
    if (progress.event === 'Started') {
      totalBytes = progress.data.contentLength ?? 0
      onEvent?.({ phase: 'downloading', percent: totalBytes > 0 ? 0 : null })
    } else if (progress.event === 'Progress') {
      downloadedBytes += progress.data.chunkLength
      onEvent?.({
        phase: 'downloading',
        percent: totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null,
      })
    } else if (progress.event === 'Finished') {
      onEvent?.({ phase: 'installing', percent: 100 })
    }
  })
}

/** Relaunches the app to complete an install (macOS/Linux need this explicitly; Windows exits on its own). */
export async function relaunchApp(): Promise<void> {
  if (!isTauriRuntime()) return
  await relaunch()
}

export function clearPendingNativeUpdate(): void {
  pendingUpdate = null
}
