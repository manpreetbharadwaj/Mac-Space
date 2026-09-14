/**
 * Real (not simulated) startup progress. `useAppStore.init()` marks each key
 * done the moment its underlying service call actually resolves — see the
 * `track()` wrapper there. This file only turns that into human-readable,
 * honestly-ordered status copy: the label shown is always the first group,
 * in this fixed priority order, that still has unresolved calls — so it
 * never names something that has already finished, regardless of the real
 * (unpredictable, parallel) resolution order underneath.
 */
export type InitStepKey =
  | 'disk'
  | 'categories'
  | 'cleanupItems'
  | 'applications'
  | 'browserProfiles'
  | 'permissions'
  | 'notificationPermission'
  | 'schedule'
  | 'settings'
  | 'history'
  | 'scanSession'
  | 'scheduleInstalled'
  | 'scanEvents'

export const INIT_STEP_KEYS: InitStepKey[] = [
  'disk',
  'categories',
  'cleanupItems',
  'applications',
  'browserProfiles',
  'permissions',
  'notificationPermission',
  'schedule',
  'settings',
  'history',
  'scanSession',
  'scheduleInstalled',
  'scanEvents',
]

interface StageGroup {
  keys: InitStepKey[]
  label: string
}

const STAGE_GROUPS: StageGroup[] = [
  { keys: ['disk'], label: 'Reading storage information…' },
  { keys: ['categories', 'cleanupItems'], label: 'Analyzing storage categories…' },
  { keys: ['applications'], label: 'Checking installed applications…' },
  { keys: ['browserProfiles'], label: 'Checking browser data…' },
  { keys: ['permissions', 'notificationPermission'], label: 'Checking permissions…' },
  { keys: ['schedule', 'settings', 'history', 'scanSession', 'scheduleInstalled', 'scanEvents'], label: 'Loading your preferences…' },
]

const FINAL_LABEL = 'Preparing your dashboard…'

export function deriveStartupLabel(done: Record<InitStepKey, boolean>): string {
  for (const group of STAGE_GROUPS) {
    if (group.keys.some((key) => !done[key])) return group.label
  }
  return FINAL_LABEL
}

export function createInitStepsDone(): Record<InitStepKey, boolean> {
  return Object.fromEntries(INIT_STEP_KEYS.map((key) => [key, false])) as Record<InitStepKey, boolean>
}
