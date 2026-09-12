import type { RemoteConfig, Value } from 'firebase/remote-config'
import { buildDefaultRemoteConfig } from './remoteConfig/remoteConfigDefaults'
import { applyDevScenarioOverride } from './remoteConfig/devScenarioOverride'
import type { RemoteAppConfig, RemoteConfigSnapshot, RemoteConfigSource } from './remoteConfig/remoteConfigTypes'

export type { RemoteAppConfig, RemoteConfigSnapshot, RemoteConfigSource } from './remoteConfig/remoteConfigTypes'

// Firebase is dynamically imported (below) instead of statically at the top
// of this file so it lands in its own lazy-loaded chunk — most of the app
// doesn't need it, and it shouldn't add to the parse/eval cost of the
// initial bundle. It's still fetched immediately at startup (see
// hooks/useUpdateLifecycle.ts), just off the critical rendering path.
type FirebaseAppModule = typeof import('firebase/app')
type RemoteConfigModule = typeof import('firebase/remote-config')

// 1 hour default in production; override in .env for faster iteration during
// development (see docs/remote-updates-setup.md "Test development/staging
// values safely"). Firebase itself also throttles below ~5 min regardless.
const DEFAULT_MIN_FETCH_INTERVAL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

function readMinFetchIntervalMs(): number {
  const raw = Number(import.meta.env.VITE_REMOTE_CONFIG_MIN_FETCH_INTERVAL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_FETCH_INTERVAL_MS
}

function readFirebaseWebConfig() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  const appId = import.meta.env.VITE_FIREBASE_APP_ID
  if (!apiKey || !projectId || !appId) return null
  return {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId,
  }
}

function updateCheckDisabledByEnv(): boolean {
  return import.meta.env.VITE_UPDATE_CHECK_ENABLED === 'false'
}

function readRemoteValue<T extends string | boolean>(all: Record<string, Value>, key: string, fallback: T): T {
  const value = all[key]
  if (!value) return fallback
  return (typeof fallback === 'boolean' ? value.asBoolean() : value.asString()) as T
}

function buildConfigFromRemote(all: Record<string, Value>, defaults: RemoteAppConfig): RemoteAppConfig {
  const entries = (Object.keys(defaults) as (keyof RemoteAppConfig)[]).map(
    (key) => [key, readRemoteValue(all, key, defaults[key] as never)] as const,
  )
  return Object.fromEntries(entries) as unknown as RemoteAppConfig
}

let remoteConfigInstance: RemoteConfig | null | undefined // undefined = init not attempted yet
let remoteConfigModule: RemoteConfigModule | null = null
let initPromise: Promise<void> | null = null
let defaults: RemoteAppConfig | null = null
let lastSnapshot: RemoteConfigSnapshot | null = null

async function ensureInitialized(currentVersion: string): Promise<void> {
  if (!defaults) defaults = buildDefaultRemoteConfig(currentVersion)
  if (!lastSnapshot) {
    lastSnapshot = { config: defaults, source: 'default', fetchedAt: null, error: null }
  }
  if (remoteConfigInstance !== undefined) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    if (updateCheckDisabledByEnv()) {
      remoteConfigInstance = null
      return
    }
    const firebaseWebConfig = readFirebaseWebConfig()
    if (!firebaseWebConfig) {
      console.info(
        '[remoteConfigService] Firebase env vars not configured — running on in-app defaults only. See docs/remote-updates-setup.md.',
      )
      remoteConfigInstance = null
      return
    }
    try {
      const [{ initializeApp }, rcModule]: [FirebaseAppModule, RemoteConfigModule] = await Promise.all([
        import('firebase/app'),
        import('firebase/remote-config'),
      ])
      remoteConfigModule = rcModule
      const supported = await rcModule.isSupported()
      if (!supported) {
        remoteConfigInstance = null
        return
      }
      const app = initializeApp(firebaseWebConfig)
      const rc = rcModule.getRemoteConfig(app)
      rc.settings.minimumFetchIntervalMillis = readMinFetchIntervalMs()
      rc.settings.fetchTimeoutMillis = FETCH_TIMEOUT_MS
      rc.defaultConfig = defaults as unknown as Record<string, string | number | boolean>
      remoteConfigInstance = rc
    } catch (err) {
      console.warn('[remoteConfigService] Firebase initialization failed; using local defaults.', err)
      remoteConfigInstance = null
    }
  })()
  return initPromise
}

/**
 * Fetches and activates the latest Remote Config values. Safe to call
 * whether or not Firebase is configured/reachable — always resolves (never
 * rejects) with the best data currently available: freshly fetched, a
 * previously-fetched value still cached, or the in-app defaults.
 *
 * Pass `force: true` to bypass the minimum fetch interval (used for the
 * user-initiated "Check for Updates" button) — startup and focus-regain
 * checks should omit it so Firebase isn't polled aggressively.
 */
export async function fetchRemoteConfig(currentVersion: string, options?: { force?: boolean }): Promise<RemoteConfigSnapshot> {
  await ensureInitialized(currentVersion)
  const configDefaults = defaults!

  if (!remoteConfigInstance || !remoteConfigModule) {
    lastSnapshot = { config: configDefaults, source: 'default', fetchedAt: null, error: lastSnapshot?.error ?? null }
    return applyDevOverrideIfAny(lastSnapshot, currentVersion)
  }
  const { fetchAndActivate, getAll, getValue } = remoteConfigModule

  const originalInterval = remoteConfigInstance.settings.minimumFetchIntervalMillis
  if (options?.force) remoteConfigInstance.settings.minimumFetchIntervalMillis = 0

  try {
    await fetchAndActivate(remoteConfigInstance)
    const all = getAll(remoteConfigInstance)
    lastSnapshot = {
      config: buildConfigFromRemote(all, configDefaults),
      source: 'remote',
      fetchedAt: Date.now(),
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[remoteConfigService] Fetch failed; using last known values.', message)
    // Even on a failed fetch, previously-activated remote values (this
    // session or persisted from an earlier launch) stay available via
    // getValue()/getAll() — only fall back to 'default' if nothing was ever
    // successfully activated.
    const source: RemoteConfigSource = getValue(remoteConfigInstance, 'latest_version').getSource() === 'default' ? 'default' : 'cache'
    const all = getAll(remoteConfigInstance)
    lastSnapshot = {
      config: buildConfigFromRemote(all, configDefaults),
      source,
      fetchedAt: source === 'cache' ? lastSnapshot?.fetchedAt ?? null : null,
      error: message,
    }
  } finally {
    if (options?.force) remoteConfigInstance.settings.minimumFetchIntervalMillis = originalInterval
  }

  return applyDevOverrideIfAny(lastSnapshot, currentVersion)
}

/** See devScenarioOverride.ts — statically eliminated from production builds. */
function applyDevOverrideIfAny(snapshot: RemoteConfigSnapshot, currentVersion: string): RemoteConfigSnapshot {
  const override = applyDevScenarioOverride(snapshot.config, currentVersion)
  if (!override) return snapshot
  const overridden = { ...snapshot, config: override.config, source: override.source }
  lastSnapshot = overridden
  return overridden
}

export function getLastRemoteConfigSnapshot(currentVersion: string): RemoteConfigSnapshot {
  if (!lastSnapshot) {
    const configDefaults = buildDefaultRemoteConfig(currentVersion)
    defaults = configDefaults
    lastSnapshot = { config: configDefaults, source: 'default', fetchedAt: null, error: null }
  }
  return lastSnapshot
}

/** True once we've determined Firebase is not configured/reachable/enabled — useful for diagnostics in Settings. */
export function isRemoteConfigDisabled(): boolean {
  return remoteConfigInstance === null
}

export const remoteConfigService = {
  fetch: fetchRemoteConfig,
  getSnapshot: getLastRemoteConfigSnapshot,
  isDisabled: isRemoteConfigDisabled,
}
