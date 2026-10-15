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
import { useI18n } from '@/i18n'

const TABS: FileKind[] = ['large', 'old', 'download', 'installer', 'archive', 'duplicate']

type SortKey = 'size' | 'age' | 'name'

// Decimal, matching src/lib/format.ts's display units.
const SIZE_THRESHOLDS = [500 * 1000 ** 2, 1000 ** 3, 5 * 1000 ** 3]

const AGE_THRESHOLDS = [30, 60, 90, 180]

export function Files() {
  const [params, setParams] = useSearchParams()
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const activeTab = (params.get('tab') as FileKind | null) ?? 'large'
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('size')
  const [sizeThreshold, setSizeThreshold] = useState(0)
  const [ageThreshold, setAgeThreshold] = useState(0)
  const { t, fmt } = useI18n()

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
        title={t('files.title')}
        description={t('files.description')}
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
              activeTab === tab ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted hover:text-text',
            )}
          >
            {t(`files.tab.${tab}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('files.search')}
            aria-label={t('files.search')}
            className="w-full rounded-lg border border-border bg-surface py-1.5 ps-8 pe-3 text-[12px] text-text placeholder:text-text-faint"
          />
        </div>

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
        >
          <option value="size">{t('files.sort.size')}</option>
          <option value="age">{t('files.sort.age')}</option>
          <option value="name">{t('files.sort.name')}</option>
        </select>

        {activeTab === 'large' && (
          <select
            value={sizeThreshold}
            onChange={(e) => setSizeThreshold(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
          >
            <option value={0}>{t('files.anySize')}</option>
            {SIZE_THRESHOLDS.map((bytes) => (
              <option key={bytes} value={bytes}>
                {t('files.over', { size: fmt.bytes(bytes, 0) })}
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
            <option value={0}>{t('files.anyAge')}</option>
            {AGE_THRESHOLDS.map((d) => (
              <option key={d} value={d}>
                {t('files.daysPlus', { days: fmt.number(d) })}
              </option>
            ))}
          </select>
        )}
      </div>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <CardBody>
            <EmptyState icon={FolderOpen} title={t('files.emptyTitle')} description={t('files.emptyBody')} />
          </CardBody>
        ) : (
          items.map((item) => <CleanupItemRow key={item.id} item={item} />)
        )}
      </Card>
    </div>
  )
}
