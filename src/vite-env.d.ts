/// <reference types="vite/client" />

/** Injected at build time by vite.config.ts from src-tauri/tauri.conf.json's `version`. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_UPDATE_CHECK_ENABLED?: string
  readonly VITE_REMOTE_CONFIG_MIN_FETCH_INTERVAL_MS?: string
  /** Dev-only test scenario — see services/remoteConfig/devScenarioOverride.ts. Never read in production builds. */
  readonly VITE_DEV_UPDATE_SCENARIO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
