import { useEffect } from 'react'
import type { ThemePreference } from '@/types'

export function useThemeSync(theme: ThemePreference | undefined) {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    function apply() {
      const resolved = theme === 'system' || !theme ? (media.matches ? 'dark' : 'light') : theme
      root.classList.toggle('dark', resolved === 'dark')
    }

    apply()

    if (theme === 'system' || !theme) {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    return undefined
  }, [theme])
}
