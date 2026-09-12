import { compareVersions, isValidVersion } from '@/lib/semver'
import type { RemoteAppConfig, RemoteConfigSnapshot } from './remoteConfig/remoteConfigTypes'

export type UpdatePolicy =
  | { kind: 'none' }
  | { kind: 'optional'; latestVersion: string }
  | { kind: 'mandatory'; reason: 'minimum-version' | 'forced'; latestVersion: string }

/**
 * Implements the four update cases from the spec, in priority order:
 *   A. currentVersion < minimum_supported_version           -> mandatory
 *   B. force_update && currentVersion < latest_version       -> mandatory
 *   C. currentVersion < latest_version (else)                -> optional
 *   D. currentVersion >= latest_version                      -> none
 *
 * A malformed or missing remote version string is never trusted enough to
 * force anything — it degrades to "no policy from that field" rather than
 * blocking the user, matching the "network/config failure must never
 * accidentally force-update or lock out users" requirement.
 */
export function computeUpdatePolicy(currentVersion: string, config: RemoteAppConfig): UpdatePolicy {
  if (!config.update_enabled) return { kind: 'none' }
  if (!isValidVersion(currentVersion)) return { kind: 'none' }

  const minimumValid = isValidVersion(config.minimum_supported_version)
  const latestValid = isValidVersion(config.latest_version)

  if (minimumValid && compareVersions(currentVersion, config.minimum_supported_version) < 0) {
    return {
      kind: 'mandatory',
      reason: 'minimum-version',
      latestVersion: latestValid ? config.latest_version : config.minimum_supported_version,
    }
  }

  if (!latestValid || compareVersions(currentVersion, config.latest_version) >= 0) {
    return { kind: 'none' }
  }

  if (config.force_update) {
    return { kind: 'mandatory', reason: 'forced', latestVersion: config.latest_version }
  }

  return { kind: 'optional', latestVersion: config.latest_version }
}

/**
 * Maintenance mode may only ever come from a genuinely fetched or cached
 * remote value — never from the in-app defaults — so an unreachable Firebase
 * can never accidentally lock users out (spec section 11).
 */
export function computeMaintenanceActive(snapshot: RemoteConfigSnapshot): boolean {
  return snapshot.config.maintenance_mode && snapshot.source !== 'default'
}

/**
 * Remote Config decides *policy*; the Tauri updater's own check() is the
 * only authority on whether a real signed artifact actually exists (see the
 * architecture note in docs/remote-updates-setup.md). Without this merge, a
 * genuinely published, signed update would stay invisible to every user
 * until Remote Config's `latest_version` is separately bumped to match —
 * including the common case of Firebase not being configured at all, where
 * `policy` is always 'none' by construction.
 *
 * This only ever *reveals* an update Remote Config didn't know about, and
 * only at the weakest ('optional') tier — it can't escalate to mandatory,
 * can't override maintenance mode, and respects `update_enabled` as a kill
 * switch. A native check failure (network/parse error) yields `nativeUpdate:
 * null` here, which changes nothing — so this can never force an update or
 * lock anyone out, same guarantee as computeUpdatePolicy itself.
 */
export function mergeNativeAvailability(
  policy: UpdatePolicy,
  nativeUpdate: { version: string } | null,
  currentVersion: string,
  updateEnabled: boolean,
): UpdatePolicy {
  if (policy.kind !== 'none') return policy
  if (!updateEnabled || !nativeUpdate) return policy
  if (!isValidVersion(nativeUpdate.version) || !isValidVersion(currentVersion)) return policy
  if (compareVersions(currentVersion, nativeUpdate.version) >= 0) return policy
  return { kind: 'optional', latestVersion: nativeUpdate.version }
}
