import { create } from 'zustand'
import { getInstalledAppVersion } from '@/lib/appVersion'
import { isTauriRuntime } from '@/services/environment'
import { fetchRemoteConfig, type RemoteAppConfig, type RemoteConfigSource } from '@/services/remoteConfigService'
import { buildDefaultRemoteConfig } from '@/services/remoteConfig/remoteConfigDefaults'
import { computeMaintenanceActive, computeUpdatePolicy, mergeNativeAvailability, type UpdatePolicy } from '@/services/updatePolicy'
import {
  checkNativeUpdate,
  downloadAndInstallNativeUpdate,
  relaunchApp,
  type NativeUpdateInfo,
} from '@/services/updateService'

/** Don't re-check on every focus regain — only after this much idle time. */
export const FOCUS_RECHECK_INTERVAL_MS = 60 * 60 * 1000

export type InstallState = 'idle' | 'downloading' | 'installing' | 'done' | 'error'

interface UpdateState {
  initialized: boolean
  currentVersion: string
  remoteConfig: RemoteAppConfig
  remoteConfigSource: RemoteConfigSource
  remoteConfigError: string | null
  lastCheckedAt: number | null
  checking: boolean
  policy: UpdatePolicy
  maintenanceActive: boolean
  /** The latest_version the user dismissed with "Later" — suppresses the optional dialog for that version for the rest of this session. */
  dismissedOptionalVersion: string | null
  nativeUpdate: NativeUpdateInfo | null
  nativeCheckError: string | null
  installState: InstallState
  installProgress: number | null
  installError: string | null

  initialize: () => Promise<void>
  checkForUpdates: (options?: { force?: boolean }) => Promise<void>
  maybeCheckOnFocus: () => void
  dismissOptionalUpdate: () => void
  startUpdate: () => Promise<void>
}

function applySnapshot(
  set: (partial: Partial<UpdateState>) => void,
  currentVersion: string,
  snapshot: { config: RemoteAppConfig; source: RemoteConfigSource; error: string | null },
) {
  const policy = computeUpdatePolicy(currentVersion, snapshot.config)
  const maintenanceActive = computeMaintenanceActive({ config: snapshot.config, source: snapshot.source, fetchedAt: null, error: null })
  set({
    remoteConfig: snapshot.config,
    remoteConfigSource: snapshot.source,
    remoteConfigError: snapshot.error,
    policy,
    maintenanceActive,
  })
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  initialized: false,
  currentVersion: __APP_VERSION__,
  remoteConfig: buildDefaultRemoteConfig(__APP_VERSION__),
  remoteConfigSource: 'default',
  remoteConfigError: null,
  lastCheckedAt: null,
  checking: false,
  policy: { kind: 'none' },
  maintenanceActive: false,
  dismissedOptionalVersion: null,
  nativeUpdate: null,
  nativeCheckError: null,
  installState: 'idle',
  installProgress: null,
  installError: null,

  initialize: async () => {
    // Set the flag synchronously, before the first `await` — otherwise two
    // near-simultaneous callers (e.g. React StrictMode's double-invoked
    // mount effect in dev) can both pass the guard before either finishes
    // resolving the version, firing two redundant native update checks.
    if (get().initialized) return
    set({ initialized: true })
    const currentVersion = await getInstalledAppVersion()
    set({ currentVersion })
    await get().checkForUpdates()
  },

  checkForUpdates: async (options) => {
    if (get().checking) return
    set({ checking: true })
    const currentVersion = get().currentVersion
    try {
      const snapshot = await fetchRemoteConfig(currentVersion, options)
      applySnapshot(set, currentVersion, snapshot)

      // The Tauri updater is the source of truth for whether a real signed
      // artifact is downloadable; Remote Config only decides *policy*
      // (mandatory/optional/messaging). Only bother asking it when running
      // as the real desktop app.
      if (isTauriRuntime()) {
        try {
          const nativeUpdate = await checkNativeUpdate()
          set({ nativeUpdate, nativeCheckError: null })
        } catch (err) {
          set({ nativeUpdate: null, nativeCheckError: err instanceof Error ? err.message : String(err) })
        }
        // A real, genuinely-newer signed artifact should be discoverable
        // even if Remote Config hasn't been told about it yet (e.g. no
        // Firebase configured, or latest_version hasn't been bumped) — see
        // mergeNativeAvailability's doc comment. Never escalates past
        // 'optional' and never fires when Remote Config already has an
        // opinion, so every existing safety guarantee still holds.
        set((state) => ({
          policy: mergeNativeAvailability(state.policy, state.nativeUpdate, currentVersion, state.remoteConfig.update_enabled),
        }))
      }
    } finally {
      set({ checking: false, lastCheckedAt: Date.now() })
    }
  },

  maybeCheckOnFocus: () => {
    const { lastCheckedAt, checking } = get()
    if (checking) return
    if (lastCheckedAt && Date.now() - lastCheckedAt < FOCUS_RECHECK_INTERVAL_MS) return
    void get().checkForUpdates()
  },

  dismissOptionalUpdate: () => {
    const policy = get().policy
    if (policy.kind === 'optional') {
      set({ dismissedOptionalVersion: policy.latestVersion })
    }
  },

  startUpdate: async () => {
    set({ installState: 'downloading', installProgress: null, installError: null })
    try {
      if (!get().nativeUpdate) {
        // Give the button a second chance to find an update — covers the
        // case where the Remote Config policy fired before the native
        // manifest check finished, or the check never ran yet.
        const nativeUpdate = await checkNativeUpdate()
        set({ nativeUpdate })
      }
      if (!get().nativeUpdate) {
        throw new Error(
          'No downloadable update was found yet. The update server may not have published this version’s installer.',
        )
      }
      await downloadAndInstallNativeUpdate((progress) => set({ installState: progress.phase, installProgress: progress.percent }))
      await relaunchApp()
      set({ installState: 'done' })
    } catch (err) {
      set({ installState: 'error', installError: err instanceof Error ? err.message : String(err) })
    }
  },
}))
