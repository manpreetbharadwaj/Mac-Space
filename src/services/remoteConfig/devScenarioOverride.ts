import { parseVersion } from '@/lib/semver'
import type { RemoteAppConfig, RemoteConfigSource } from './remoteConfigTypes'

/**
 * Local-only test scenarios for the four update-policy cases plus
 * maintenance mode, so all of them can be exercised without a real Firebase
 * project — see docs/remote-updates-setup.md "Testing without production
 * risk". Selected via VITE_DEV_UPDATE_SCENARIO in .env.
 *
 * Gated on `import.meta.env.DEV`, which Vite replaces with the literal
 * `false` in a production build (`vite build` / `tauri build`) — the whole
 * branch below is dead-code-eliminated from anything users install, so this
 * can never fire outside a local `tauri dev` / `vite dev` session.
 */
export type DevUpdateScenario = 'optional' | 'mandatory-forced' | 'mandatory-minimum' | 'maintenance'

function isDevUpdateScenario(value: string | undefined): value is DevUpdateScenario {
  return value === 'optional' || value === 'mandatory-forced' || value === 'mandatory-minimum' || value === 'maintenance'
}

/** A version guaranteed to be newer than any real current version, for scenario purposes. */
function higherVersion(currentVersion: string): string {
  const parsed = parseVersion(currentVersion)
  if (!parsed) return '999.0.0'
  return `${parsed.major + 1}.0.0`
}

export function applyDevScenarioOverride(
  config: RemoteAppConfig,
  currentVersion: string,
): { config: RemoteAppConfig; source: RemoteConfigSource } | null {
  if (!import.meta.env.DEV) return null
  const scenario = import.meta.env.VITE_DEV_UPDATE_SCENARIO
  if (!isDevUpdateScenario(scenario)) return null

  const higher = higherVersion(currentVersion)
  const base: RemoteAppConfig = { ...config, update_enabled: true, maintenance_mode: false }

  switch (scenario) {
    case 'optional':
      return {
        source: 'remote',
        config: { ...base, force_update: false, minimum_supported_version: currentVersion, latest_version: higher },
      }
    case 'mandatory-forced':
      return {
        source: 'remote',
        config: { ...base, force_update: true, minimum_supported_version: currentVersion, latest_version: higher },
      }
    case 'mandatory-minimum':
      return {
        source: 'remote',
        config: { ...base, force_update: false, minimum_supported_version: higher, latest_version: higher },
      }
    case 'maintenance':
      return {
        source: 'remote',
        config: {
          ...base,
          maintenance_mode: true,
          maintenance_title: 'Scheduled Maintenance (dev preview)',
          maintenance_message: 'This is a local dev-only preview of the maintenance screen — see .env VITE_DEV_UPDATE_SCENARIO.',
        },
      }
  }
}
