import type { LanguageCode } from '@/types'

export interface LanguageInfo {
  code: LanguageCode
  /** Shown in the picker in its own language, so anyone can find theirs. */
  nativeName: string
  /** BCP 47 tag used for Intl number/date formatting. */
  intlLocale: string
  dir: 'ltr' | 'rtl'
}

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', nativeName: 'English', intlLocale: 'en', dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch', intlLocale: 'de', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', intlLocale: 'fr', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', intlLocale: 'es', dir: 'ltr' },
  { code: 'it', nativeName: 'Italiano', intlLocale: 'it', dir: 'ltr' },
  { code: 'pt', nativeName: 'Português', intlLocale: 'pt', dir: 'ltr' },
  { code: 'nl', nativeName: 'Nederlands', intlLocale: 'nl', dir: 'ltr' },
  { code: 'hi', nativeName: 'हिन्दी', intlLocale: 'hi', dir: 'ltr' },
  { code: 'ja', nativeName: '日本語', intlLocale: 'ja', dir: 'ltr' },
  { code: 'ko', nativeName: '한국어', intlLocale: 'ko', dir: 'ltr' },
  { code: 'zh-Hans', nativeName: '简体中文', intlLocale: 'zh-Hans', dir: 'ltr' },
  { code: 'zh-Hant', nativeName: '繁體中文', intlLocale: 'zh-Hant', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية', intlLocale: 'ar', dir: 'rtl' },
  { code: 'tr', nativeName: 'Türkçe', intlLocale: 'tr', dir: 'ltr' },
  { code: 'ru', nativeName: 'Русский', intlLocale: 'ru', dir: 'ltr' },
  { code: 'id', nativeName: 'Bahasa Indonesia', intlLocale: 'id', dir: 'ltr' },
]

export const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l])) as Record<LanguageCode, LanguageInfo>

const TRADITIONAL_CHINESE_REGIONS = ['TW', 'HK', 'MO']

/** Maps one BCP 47 tag (e.g. "pt-BR", "zh-Hant-TW", "zh-HK") to a supported language, if any. */
export function matchLanguageTag(tag: string): LanguageCode | null {
  const parts = tag.replace('_', '-').split('-')
  const base = parts[0]?.toLowerCase()
  if (base === 'zh') {
    const rest = parts.slice(1).map((p) => p.toLowerCase())
    if (rest.includes('hant')) return 'zh-Hant'
    if (rest.includes('hans')) return 'zh-Hans'
    return parts.slice(1).some((p) => TRADITIONAL_CHINESE_REGIONS.includes(p.toUpperCase())) ? 'zh-Hant' : 'zh-Hans'
  }
  const hit = LANGUAGES.find((l) => l.code === base)
  return hit ? hit.code : null
}

/**
 * The first supported language in the user's macOS preferred-language order.
 * WKWebView's `navigator.languages` is that order (System Settings ›
 * General › Language & Region), so no native call is needed for this.
 */
export function detectSystemLanguage(): LanguageCode {
  const tags = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []
  for (const tag of tags) {
    const match = tag ? matchLanguageTag(tag) : null
    if (match) return match
  }
  return 'en'
}
