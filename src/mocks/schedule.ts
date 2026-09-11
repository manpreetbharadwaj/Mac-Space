import type { ScheduleRule, Settings } from '@/types'
import { daysAgoIso } from '@/lib/format'

const now = new Date()
const nextRun = new Date(now)
nextRun.setDate(nextRun.getDate() + 4)

export const scheduleRule: ScheduleRule = {
  enabled: true,
  frequency: 'weekly',
  mode: 'reminder',
  safeCategories: ['developer', 'system', 'browser'],
  thresholdFreeGb: 40,
  thresholdReclaimableGb: 15,
  emailSummaryEnabled: false,
  lastRunAt: daysAgoIso(3),
  nextRunAt: nextRun.toISOString(),
}

export const defaultSettings: Settings = {
  theme: 'system',
  permanentDeleteEnabled: false,
  exclusions: ['~/Projects/active-client-app', '~/Library/Application Support/1Password'],
  notificationsEnabled: true,
  analyticsOptIn: false,
}
