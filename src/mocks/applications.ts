import type { ApplicationItem, UsageStatus } from '@/types'
import { daysAgoIso } from '@/lib/format'
import { gb, mb, nextId } from './seed'

function statusFor(daysAgo: number): UsageStatus {
  if (daysAgo <= 7) return 'active'
  if (daysAgo <= 60) return 'infrequent'
  return 'not-used'
}

interface Draft {
  name: string
  sizeBytes: number
  lastUsedDaysAgo: number
  associatedCleanupBytes: number
  accent: string
}

const drafts: Draft[] = [
  { name: 'Xcode', sizeBytes: gb(14.2), lastUsedDaysAgo: 0, associatedCleanupBytes: gb(1.1), accent: '#3b82f6' },
  { name: 'Visual Studio Code', sizeBytes: gb(0.6), lastUsedDaysAgo: 0, associatedCleanupBytes: mb(180), accent: '#06b6d4' },
  { name: 'Docker Desktop', sizeBytes: gb(1.8), lastUsedDaysAgo: 4, associatedCleanupBytes: mb(320), accent: '#0ea5e9' },
  { name: 'Slack', sizeBytes: mb(420), lastUsedDaysAgo: 0, associatedCleanupBytes: mb(540), accent: '#a855f7' },
  { name: 'Figma', sizeBytes: mb(380), lastUsedDaysAgo: 2, associatedCleanupBytes: mb(90), accent: '#f97316' },
  { name: 'Final Cut Pro', sizeBytes: gb(4.1), lastUsedDaysAgo: 6, associatedCleanupBytes: gb(3.1), accent: '#ec4899' },
  { name: 'GarageBand', sizeBytes: gb(2.9), lastUsedDaysAgo: 145, associatedCleanupBytes: mb(210), accent: '#f59e0b' },
  { name: 'iMovie', sizeBytes: gb(3.4), lastUsedDaysAgo: 210, associatedCleanupBytes: mb(140), accent: '#ef4444' },
  { name: 'Unity Hub', sizeBytes: gb(2.2), lastUsedDaysAgo: 260, associatedCleanupBytes: gb(1.4), accent: '#64748b' },
  { name: 'Android Studio', sizeBytes: gb(3.8), lastUsedDaysAgo: 96, associatedCleanupBytes: gb(2.9), accent: '#22c55e' },
  { name: 'Parallels Desktop', sizeBytes: gb(1.2), lastUsedDaysAgo: 300, associatedCleanupBytes: mb(60), accent: '#dc2626' },
  { name: 'Adobe Lightroom Classic', sizeBytes: gb(1.6), lastUsedDaysAgo: 190, associatedCleanupBytes: mb(480), accent: '#3ddc97' },
  { name: 'Zoom', sizeBytes: mb(310), lastUsedDaysAgo: 1, associatedCleanupBytes: mb(70), accent: '#2563eb' },
  { name: 'CleanMyMac X (old trial)', sizeBytes: mb(240), lastUsedDaysAgo: 400, associatedCleanupBytes: mb(40), accent: '#94a3b8' },
  { name: 'Steam', sizeBytes: gb(0.9), lastUsedDaysAgo: 340, associatedCleanupBytes: mb(120), accent: '#1e293b' },
  { name: 'Notion', sizeBytes: mb(260), lastUsedDaysAgo: 3, associatedCleanupBytes: mb(50), accent: '#111827' },
]

export const applications: ApplicationItem[] = drafts.map((draft) => ({
  id: nextId('app'),
  name: draft.name,
  sizeBytes: draft.sizeBytes,
  lastUsedAt: daysAgoIso(draft.lastUsedDaysAgo),
  lastUsedDaysAgo: draft.lastUsedDaysAgo,
  usageStatus: statusFor(draft.lastUsedDaysAgo),
  associatedCleanupBytes: draft.associatedCleanupBytes,
  accent: draft.accent,
  initial: draft.name.charAt(0).toUpperCase(),
}))
