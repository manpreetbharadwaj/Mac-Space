import { appEn, type AppMessageKey } from './locales/app/en'

/**
 * Translates text that reaches the UI as already-built English strings —
 * produced by the classifier (services/tauri/classify.ts), the storage
 * services, or the Rust backend (trash failure reasons, cleanup progress).
 * Their data model is deliberately left untouched (the cleaner keeps working
 * exactly as before); translation happens only at render time.
 *
 * Every `data.*` entry in the English app catalog is matched against its own
 * English text: exact strings directly, and templates with `{placeholders}`
 * as patterns whose captured values are passed back into the translation.
 * Text that matches nothing (file names, paths, app names, remote content)
 * is returned unchanged.
 */
type Matcher = { key: AppMessageKey; regex: RegExp; names: string[] }

const exact = new Map<string, AppMessageKey>()
const patterns: Matcher[] = []

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

for (const [key, text] of Object.entries(appEn) as [AppMessageKey, string][]) {
  if (!key.startsWith('data.')) continue
  const names = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
  if (names.length === 0) {
    exact.set(text, key)
    continue
  }
  const source = text
    .split(/\{\w+\}/)
    .map(escapeRegex)
    .join('(.+?)')
  patterns.push({ key, regex: new RegExp(`^${source}$`, 's'), names })
}

// Typographic and plain apostrophes both occur in source strings.
const normalize = (s: string) => s.replace(/'/g, '’')

export function matchDataText(text: string): { key: AppMessageKey; vars?: Record<string, string> } | null {
  const hit = exact.get(text) ?? exact.get(normalize(text))
  if (hit) return { key: hit }
  for (const p of patterns) {
    const m = p.regex.exec(text) ?? p.regex.exec(normalize(text))
    if (m) return { key: p.key, vars: Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])) }
  }
  return null
}

/**
 * The relative "last used" labels produced by src/lib/format.ts's
 * formatRelativeDays — parsed back to an approximate day count so they can
 * be re-rendered with Intl.RelativeTimeFormat in the active language.
 */
export function parseRelativeDays(text: string): number | null {
  if (text === 'Today') return 0
  if (text === 'Yesterday') return 1
  if (text === '1 week ago') return 7
  if (text === '1 month ago') return 30
  const m = /^(\d+) (day|days|weeks|months|year|years) ago$/.exec(text)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2]
  if (unit.startsWith('day')) return n
  if (unit === 'weeks') return n * 7
  if (unit === 'months') return n * 30
  return n * 365
}
