import type { CleanupSession } from '@/types'

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
}

export function sumSavedWithin(history: CleanupSession[], maxDays: number): number {
  return history.filter((s) => daysSince(s.completedAt) <= maxDays).reduce((sum, s) => sum + s.actualBytes, 0)
}

export function sumSavedLifetime(history: CleanupSession[]): number {
  return history.reduce((sum, s) => sum + s.actualBytes, 0)
}

export function biggestSingleCleanup(history: CleanupSession[]): CleanupSession | null {
  if (history.length === 0) return null
  return history.reduce((biggest, s) => (s.actualBytes > biggest.actualBytes ? s : biggest), history[0])
}

export function topCategoriesFromHistory(history: CleanupSession[], limit = 3) {
  const totals = new Map<string, number>()
  for (const session of history) {
    for (const entry of session.categoryBreakdown) {
      totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.bytes)
    }
  }
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
}
