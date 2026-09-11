import type { CleanupSession } from '@/types'
import { daysAgoIso } from '@/lib/format'
import { gb, mb, nextId } from './seed'

interface Draft {
  daysAgo: number
  actualBytes: number
  estimatedBytes: number
  itemCount: number
  beforeUsedBytes: number
  categoryBreakdown: CleanupSession['categoryBreakdown']
}

const drafts: Draft[] = [
  {
    daysAgo: 3,
    actualBytes: gb(24.6),
    estimatedBytes: gb(26.1),
    itemCount: 38,
    beforeUsedBytes: gb(468.2),
    categoryBreakdown: [
      { category: 'developer', bytes: gb(15.8) },
      { category: 'downloads', bytes: gb(5.2) },
      { category: 'system', bytes: gb(2.1) },
      { category: 'browser', bytes: gb(1.5) },
    ],
  },
  {
    daysAgo: 11,
    actualBytes: gb(6.4),
    estimatedBytes: gb(6.9),
    itemCount: 22,
    beforeUsedBytes: gb(452.8),
    categoryBreakdown: [
      { category: 'browser', bytes: gb(3.1) },
      { category: 'system', bytes: gb(2.4) },
      { category: 'downloads', bytes: gb(0.9) },
    ],
  },
  {
    daysAgo: 19,
    actualBytes: gb(11.2),
    estimatedBytes: gb(12.0),
    itemCount: 27,
    beforeUsedBytes: gb(458.1),
    categoryBreakdown: [
      { category: 'developer', bytes: gb(8.6) },
      { category: 'system', bytes: gb(1.8) },
      { category: 'downloads', bytes: gb(0.8) },
    ],
  },
  {
    daysAgo: 33,
    actualBytes: gb(4.1),
    estimatedBytes: gb(4.4),
    itemCount: 14,
    beforeUsedBytes: gb(449.5),
    categoryBreakdown: [
      { category: 'system', bytes: gb(2.9) },
      { category: 'browser', bytes: gb(1.2) },
    ],
  },
  {
    daysAgo: 47,
    actualBytes: gb(9.8),
    estimatedBytes: gb(10.5),
    itemCount: 31,
    beforeUsedBytes: gb(455.7),
    categoryBreakdown: [
      { category: 'developer', bytes: gb(6.6) },
      { category: 'downloads', bytes: gb(2.4) },
      { category: 'system', bytes: gb(0.8) },
    ],
  },
  {
    daysAgo: 58,
    actualBytes: mb(870 * 4),
    estimatedBytes: gb(3.9),
    itemCount: 9,
    beforeUsedBytes: gb(441.3),
    categoryBreakdown: [
      { category: 'system', bytes: gb(2.1) },
      { category: 'browser', bytes: gb(1.4) },
    ],
  },
]

export const cleanupHistory: CleanupSession[] = drafts.map((draft) => ({
  id: nextId('cleanup'),
  completedAt: daysAgoIso(draft.daysAgo),
  estimatedBytes: draft.estimatedBytes,
  actualBytes: draft.actualBytes,
  itemIds: Array.from({ length: draft.itemCount }, () => nextId('hist-item')),
  categoryBreakdown: draft.categoryBreakdown,
  beforeUsedBytes: draft.beforeUsedBytes,
  afterUsedBytes: draft.beforeUsedBytes - draft.actualBytes,
  itemCount: draft.itemCount,
}))
