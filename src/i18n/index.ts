import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { LANGUAGE_BY_CODE } from './languages'
import { makeFormatters, resolveLanguage, translate, translateDataText, translatePlural, type MessageKey, type TranslateVars } from './core'
import type { PluralKey } from './locales/app/en'

export * from './core'

export function useI18n() {
  const pref = useAppStore((s) => s.settings?.language)
  const lang = resolveLanguage(pref)
  return useMemo(() => {
    const info = LANGUAGE_BY_CODE[lang]
    return {
      lang,
      dir: info.dir,
      locale: info.intlLocale,
      t: (key: MessageKey, vars?: TranslateVars) => translate(lang, key, vars),
      tp: (key: PluralKey, count: number, vars?: TranslateVars) => translatePlural(lang, key, count, vars),
      td: (text: string | null | undefined) => translateDataText(lang, text),
      fmt: makeFormatters(info.intlLocale),
    }
  }, [lang])
}

/** Keeps <html lang/dir> in sync so Arabic lays out right-to-left. */
export function useLanguageSync() {
  const { lang, dir } = useI18n()
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])
}
