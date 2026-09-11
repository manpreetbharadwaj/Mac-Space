import type { BrowserProfile } from '@/types'
import { gb, mb } from './seed'

export const browserProfiles: BrowserProfile[] = [
  {
    id: 'safari',
    name: 'Safari',
    accent: '#0ea5e9',
    cacheBytes: gb(1.2),
    cookiesBytes: mb(340),
    passwordsCount: 184,
    bookmarksCount: 96,
    extensionsCount: 6,
    autofillEntries: 42,
    lastCleanedLabel: 'Never cleaned',
  },
  {
    id: 'chrome',
    name: 'Chrome',
    accent: '#f59e0b',
    cacheBytes: gb(2.6),
    cookiesBytes: mb(610),
    passwordsCount: 231,
    bookmarksCount: 158,
    extensionsCount: 14,
    autofillEntries: 67,
    lastCleanedLabel: '2 months ago',
  },
]
