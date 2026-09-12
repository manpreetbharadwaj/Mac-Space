import { isTauriRuntime } from '@/services/environment'

/**
 * Resolves the installed application version. Uses the real Tauri app
 * metadata when running in the desktop shell; falls back to the version
 * baked into tauri.conf.json (via the __APP_VERSION__ build-time define,
 * see vite.config.ts) for the browser-only mock prototype, which has no
 * installed app to ask.
 */
export async function getInstalledAppVersion(): Promise<string> {
  if (isTauriRuntime()) {
    const { getVersion } = await import('@tauri-apps/api/app')
    return getVersion()
  }
  return __APP_VERSION__
}
