/**
 * Typed shape of every Firebase Remote Config parameter this app reads. This
 * is the single contract between the Remote Config console and the rest of
 * the app — see remoteConfigDefaults.ts for the in-app fallback values used
 * whenever Firebase can't be reached, and docs/remote-updates-setup.md for
 * how to create these parameters in the Firebase console.
 */
export interface RemoteAppConfig {
  // --- Version / update policy (required) ---
  latest_version: string
  minimum_supported_version: string
  force_update: boolean
  update_enabled: boolean
  update_title: string
  update_message: string

  // --- Maintenance mode (required) ---
  maintenance_mode: boolean
  maintenance_title: string
  maintenance_message: string

  // --- Pricing / promotion display (prepared, not wired to payments yet) ---
  pricing_enabled: boolean
  pro_annual_price_display: string
  pro_lifetime_price_display: string
  promotion_enabled: boolean
  promotion_text: string

  // --- Future feature flags (prepared for later use) ---
  developer_cleanup_enabled: boolean
  browser_cleanup_enabled: boolean
  automatic_cleanup_enabled: boolean
  payments_enabled: boolean
  lifetime_plan_enabled: boolean
  annual_plan_enabled: boolean
  new_feature_x_enabled: boolean
}

export type RemoteConfigSource = 'remote' | 'cache' | 'default'

export interface RemoteConfigSnapshot {
  config: RemoteAppConfig
  /**
   * 'remote' = freshly fetched and activated this session.
   * 'cache' = a previous successful fetch (this session, or the SDK's own
   *   on-disk cache from an earlier launch) — still real, still trustworthy.
   * 'default' = the in-app fallback below; Firebase has never been
   *   successfully reached. Maintenance mode must never activate from this
   *   state (see computeMaintenanceState in updatePolicy.ts).
   */
  source: RemoteConfigSource
  fetchedAt: number | null
  error: string | null
}
