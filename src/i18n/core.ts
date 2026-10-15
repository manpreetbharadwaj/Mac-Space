/** Pure translation/formatting functions — no React or store imports, so the store itself can use them. */
import type { LanguageCode, LanguagePreference } from '@/types'
import { en, type Messages } from './locales/en'
import { de } from './locales/de'
import { fr } from './locales/fr'
import { es } from './locales/es'
import { it } from './locales/it'
import { pt } from './locales/pt'
import { nl } from './locales/nl'
import { hi } from './locales/hi'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { zhHans } from './locales/zh-Hans'
import { zhHant } from './locales/zh-Hant'
import { ar } from './locales/ar'
import { tr } from './locales/tr'
import { ru } from './locales/ru'
import { id } from './locales/id'
import { LANGUAGE_BY_CODE, detectSystemLanguage } from './languages'
import { appEn, pluralsEn, type AppMessageKey, type PluralForms, type PluralKey } from './locales/app/en'
import { appDe, pluralsDe } from './locales/app/de'
import { appFr, pluralsFr } from './locales/app/fr'
import { appEs, pluralsEs } from './locales/app/es'
import { appIt, pluralsIt } from './locales/app/it'
import { appPt, pluralsPt } from './locales/app/pt'
import { appNl, pluralsNl } from './locales/app/nl'
import { appHi, pluralsHi } from './locales/app/hi'
import { appJa, pluralsJa } from './locales/app/ja'
import { appKo, pluralsKo } from './locales/app/ko'
import { appZhHans, pluralsZhHans } from './locales/app/zh-Hans'
import { appZhHant, pluralsZhHant } from './locales/app/zh-Hant'
import { appAr, pluralsAr } from './locales/app/ar'
import { appTr, pluralsTr } from './locales/app/tr'
import { appRu, pluralsRu } from './locales/app/ru'
import { appId, pluralsId } from './locales/app/id'
import { matchDataText, parseRelativeDays } from './dataText'

export type { PluralKey } from './locales/app/en'
export { LANGUAGES, LANGUAGE_BY_CODE, detectSystemLanguage } from './languages'

type AllMessages = Messages & Record<AppMessageKey, string>
/** Every translatable UI key: the original screens' catalog plus the storage-cleaner catalog. */
export type MessageKey = keyof AllMessages
type Catalog = Partial<AllMessages>
type PluralCatalog = Partial<Record<PluralKey, PluralForms>>

const ENGLISH: AllMessages = { ...en, ...appEn }

const CATALOGS: Record<LanguageCode, Catalog> = {
  en: ENGLISH,
  de: { ...de, ...appDe },
  fr: { ...fr, ...appFr },
  es: { ...es, ...appEs },
  it: { ...it, ...appIt },
  pt: { ...pt, ...appPt },
  nl: { ...nl, ...appNl },
  hi: { ...hi, ...appHi },
  ja: { ...ja, ...appJa },
  ko: { ...ko, ...appKo },
  'zh-Hans': { ...zhHans, ...appZhHans },
  'zh-Hant': { ...zhHant, ...appZhHant },
  ar: { ...ar, ...appAr },
  tr: { ...tr, ...appTr },
  ru: { ...ru, ...appRu },
  id: { ...id, ...appId },
}

const PLURALS: Record<LanguageCode, PluralCatalog> = {
  en: pluralsEn,
  de: pluralsDe,
  fr: pluralsFr,
  es: pluralsEs,
  it: pluralsIt,
  pt: pluralsPt,
  nl: pluralsNl,
  hi: pluralsHi,
  ja: pluralsJa,
  ko: pluralsKo,
  'zh-Hans': pluralsZhHans,
  'zh-Hant': pluralsZhHant,
  ar: pluralsAr,
  tr: pluralsTr,
  ru: pluralsRu,
  id: pluralsId,
}

export type TranslateVars = Record<string, string | number>

export function resolveLanguage(pref: LanguagePreference | undefined): LanguageCode {
  return !pref || pref === 'system' ? detectSystemLanguage() : pref
}

/** Never returns a raw key: missing translations fall back to English. */
export function translate(lang: LanguageCode, key: MessageKey, vars?: TranslateVars): string {
  const template = CATALOGS[lang]?.[key] ?? ENGLISH[key] ?? ''
  return fill(template, vars)
}

function fill(template: string, vars?: TranslateVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

/** Plural-aware message: picks the language's plural category for `count`. */
export function translatePlural(lang: LanguageCode, key: PluralKey, count: number, vars?: TranslateVars): string {
  const locale = LANGUAGE_BY_CODE[lang].intlLocale
  const category = new Intl.PluralRules(locale).select(count)
  const forms = PLURALS[lang]?.[key]
  const template = forms?.[category] ?? forms?.other ?? pluralsEn[key][category as 'one' | 'other'] ?? pluralsEn[key].other
  return fill(template, { ...vars, count: new Intl.NumberFormat(locale).format(count) })
}

/** Translates backend/classifier-produced English text; anything unrecognized is returned as-is. */
export function translateDataText(lang: LanguageCode, text: string | null | undefined): string {
  if (!text) return text ?? ''
  if (lang === 'en') return text
  const days = parseRelativeDays(text)
  if (days !== null) return relativeDays(LANGUAGE_BY_CODE[lang].intlLocale, days)
  const hit = matchDataText(text)
  return hit ? translate(lang, hit.key, hit.vars) : text
}

/** "Today", "3 days ago", "2 months ago"… in the given locale, using the same buckets as formatRelativeDays. */
function relativeDays(locale: string, daysAgo: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (daysAgo <= 0) return rtf.format(0, 'day')
  if (daysAgo < 7) return rtf.format(-daysAgo, 'day')
  if (daysAgo < 30) return rtf.format(-Math.floor(daysAgo / 7), 'week')
  if (daysAgo < 365) return rtf.format(-Math.max(1, Math.floor(daysAgo / 30)), 'month')
  return rtf.format(-Math.floor(daysAgo / 365), 'year')
}

const GB = 1000 ** 3
const MB = 1000 ** 2
const KB = 1000

export function makeFormatters(locale: string) {
  const unit = (value: number, u: string, digits: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)

  const list = (items: string[]) => {
    try {
      return new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' }).format(items)
    } catch {
      return items.join(' ')
    }
  }

  return {
    /** Decimal units, matching how macOS itself shows storage and memory. */
    bytes(bytes: number, digits = 1): string {
      if (bytes >= GB) return unit(bytes / GB, 'gigabyte', digits)
      if (bytes >= MB) return unit(bytes / MB, 'megabyte', bytes >= 100 * MB ? 0 : digits)
      if (bytes >= KB) return unit(bytes / KB, 'kilobyte', 0)
      return unit(Math.max(0, bytes), 'byte', 0)
    },
    /** `value` is 0–100. */
    percent(value: number, digits = 0): string {
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value / 100)
    },
    number(value: number, digits = 0): string {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
    },
    /** Two largest units, e.g. "12 days, 4 hr". */
    duration(totalSecs: number): string {
      const days = Math.floor(totalSecs / 86400)
      const hours = Math.floor((totalSecs % 86400) / 3600)
      const minutes = Math.floor((totalSecs % 3600) / 60)
      const fmt = (v: number, u: string) =>
        new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'long' }).format(v)
      if (days > 0) return list([fmt(days, 'day'), ...(hours > 0 ? [fmt(hours, 'hour')] : [])])
      if (hours > 0) return list([fmt(hours, 'hour'), ...(minutes > 0 ? [fmt(minutes, 'minute')] : [])])
      return fmt(Math.max(1, minutes), 'minute')
    },
    seconds(value: number): string {
      return new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(value)
    },
    minutes(value: number): string {
      return new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(value)
    },
    dateTime(ms: number): string {
      return new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
    },
    time(ms: number): string {
      return new Date(ms).toLocaleTimeString(locale, { timeStyle: 'short' })
    },
    relativeDays(daysAgo: number): string {
      return relativeDays(locale, daysAgo)
    },
    date(iso: string | number): string {
      return new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' })
    },
    dateTimeIso(iso: string | number): string {
      return new Date(iso).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    },
    celsius(value: number): string {
      return unit(value, 'celsius', 1)
    },
  }
}

export type Formatters = ReturnType<typeof makeFormatters>

