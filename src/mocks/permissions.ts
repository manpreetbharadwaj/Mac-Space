import type { PermissionStatus } from '@/types'

export const permissions: PermissionStatus[] = [
  {
    category: 'full-disk-access',
    label: 'Full Disk Access',
    state: 'granted',
    reason: 'Needed to see the true size of caches and app support folders outside your home directory.',
  },
  {
    category: 'downloads',
    label: 'Downloads Folder',
    state: 'granted',
    reason: 'Needed to find old installers, archives, and duplicate downloads.',
  },
  {
    category: 'documents',
    label: 'Documents Folder',
    state: 'granted',
    reason: 'Needed to flag large or old documents for your review.',
  },
  {
    category: 'browser-data',
    label: 'Browser Data Access',
    state: 'denied',
    reason: 'Needed only if you want to clean browser caches — cookies and passwords are never touched automatically.',
  },
]
