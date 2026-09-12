import type { RemoteAppConfig } from './remoteConfigTypes'

/**
 * Safe in-app fallback values, used whenever Firebase Remote Config is
 * unavailable (not configured, offline, or the fetch failed) so the app
 * always keeps working. `latest_version`/`minimum_supported_version` default
 * to the app's own build version so an unreachable Firebase can never look
 * like an out-of-date or unsupported install — see lib/appVersion.ts.
 */
export function buildDefaultRemoteConfig(currentVersion: string): RemoteAppConfig {
  return {
    latest_version: currentVersion,
    minimum_supported_version: currentVersion,
    force_update: false,
    update_enabled: true,
    update_title: 'New Version Available',
    update_message: 'A new version is available.',

    maintenance_mode: false,
    maintenance_title: 'Under Maintenance',
    maintenance_message: 'Mac Storage Manager is temporarily unavailable. Please try again shortly.',

    pricing_enabled: false,
    pro_annual_price_display: '',
    pro_lifetime_price_display: '',
    promotion_enabled: false,
    promotion_text: '',

    // Existing shipped functionality fails OPEN (stays on) if Remote Config
    // is unreachable; not-yet-built functionality fails CLOSED (stays off).
    developer_cleanup_enabled: true,
    browser_cleanup_enabled: true,
    automatic_cleanup_enabled: true,
    payments_enabled: false,
    lifetime_plan_enabled: false,
    annual_plan_enabled: false,
    new_feature_x_enabled: false,
  }
}

/** Parameter keys as they must be named in the Firebase Remote Config console — see docs/remote-updates-setup.md. */
export const REMOTE_CONFIG_KEYS = [
  'latest_version',
  'minimum_supported_version',
  'force_update',
  'update_enabled',
  'update_title',
  'update_message',
  'maintenance_mode',
  'maintenance_title',
  'maintenance_message',
  'pricing_enabled',
  'pro_annual_price_display',
  'pro_lifetime_price_display',
  'promotion_enabled',
  'promotion_text',
  'developer_cleanup_enabled',
  'browser_cleanup_enabled',
  'automatic_cleanup_enabled',
  'payments_enabled',
  'lifetime_plan_enabled',
  'annual_plan_enabled',
  'new_feature_x_enabled',
] as const satisfies readonly (keyof RemoteAppConfig)[]
