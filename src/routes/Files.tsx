import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { clsx } from 'clsx'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { CleanupItemRow } from '@/components/cleanup/CleanupItemRow'
import { useAppStore } from '@/store/useAppStore'
import { FolderOpen } from 'lucide-react'
import type { FileKind } from '@/types'

const TABS: { key: FileKind; label: string }[] = [
  { key: 'large', label: 'Large Files' },
  { key: 'old', label: 'Old Files' },
  { key: 'download', label: 'Downloads' },
  { key: 'installer', label: 'Installers' },
  { key: 'archive', label: 'Archives' },
  { key: 'duplicate', label: 'Duplicates' },
]

type SortKey = 'size' | 'age' | 'name'

// Decimal, matching src/lib/format.ts's display units.
const SIZE_THRESHOLDS = [
  { label: '> 500 MB', bytes: 500 * 1000 ** 2 },
  { label: '> 1 GB', bytes: 1000 ** 3 },
  { label: '> 5 GB', bytes: 5 * 1000 ** 3 },
]

const AGE_THRESHOLDS = [30, 60, 90, 180]

export function Files() {
  const [params, setParams] = useSearchParams()
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const activeTab = (params.get('tab') as FileKind | null) ?? 'large'
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('size')
  const [sizeThreshold, setSizeThreshold] = useState(0)
  const [ageThreshold, setAgeThreshold] = useState(0)

  function setTab(tab: FileKind) {
    setParams({ tab })
  }

  const items = useMemo(() => {
    let list = cleanupItems.filter((i) => i.fileKind === activeTab && !i.excluded)
    if (search.trim()) list = list.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    if (activeTab === 'large') list = list.filter((i) => i.sizeBytes >= sizeThreshold)
    if (activeTab === 'old') list = list.filter((i) => i.ageDays >= ageThreshold)

    return [...list].sort((a, b) => {
      if (sortKey === 'size') return b.sizeBytes - a.sizeBytes
      if (sortKey === 'age') return b.ageDays - a.ageDays
      return a.name.localeCompare(b.name)
    })
  }, [cleanupItems, activeTab, search, sortKey, sizeThreshold, ageThreshold])

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        title="Files & Downloads"
        description="Large and old files, Downloads, installers, archives, and checksum-detected duplicates — reviewed before anything moves to Trash."
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
              activeTab === tab.key ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted hover:text-text',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filenames…"
            className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-[12px] text-text placeholder:text-text-faint"
          />
        </div>

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
        >
          <option value="size">Sort: Size</option>
          <option value="age">Sort: Age</option>
          <option value="name">Sort: Name</option>
        </select>

        {activeTab === 'large' && (
          <select
            value={sizeThreshold}
            onChange={(e) => setSizeThreshold(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
          >
            <option value={0}>Any size</option>
            {SIZE_THRESHOLDS.map((t) => (
              <option key={t.bytes} value={t.bytes}>
                {t.label}
              </option>
            ))}
          </select>
        )}

        {activeTab === 'old' && (
          <select
            value={ageThreshold}
            onChange={(e) => setAgeThreshold(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
          >
            <option value={0}>Any age</option>
            {AGE_THRESHOLDS.map((d) => (
              <option key={d} value={d}>
                {d}+ days
              </option>
            ))}
          </select>
        )}
      </div>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <CardBody>
            <EmptyState icon={FolderOpen} title="Nothing here" description="Try clearing filters or search." />
          </CardBody>
        ) : (
          items.map((item) => <CleanupItemRow key={item.id} item={item} />)
        )}
      </Card>
    </div>
  )
}
