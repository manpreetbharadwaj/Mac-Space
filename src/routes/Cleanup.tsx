import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Sparkles, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { CleanupItemRow } from '@/components/cleanup/CleanupItemRow'
import { useAppStore } from '@/store/useAppStore'
import type { SafetyLevel, StorageCategoryId } from '@/types'
import { useI18n } from '@/i18n'

type SortKey = 'size' | 'age' | 'safety' | 'category' | 'name'
const SAFETY_ORDER: Record<SafetyLevel, number> = { red: 0, orange: 1, green: 2 }

export function Cleanup() {
  const [params, setParams] = useSearchParams()
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const selectedIds = useAppStore((s) => s.selectedIds)
  const selectIds = useAppStore((s) => s.selectIds)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const smartSelect = useAppStore((s) => s.smartSelect)
  const { t } = useI18n()

  const [safetyFilter, setSafetyFilter] = useState<SafetyLevel | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('size')

  const categoryFilter = (params.get('category') as StorageCategoryId | null) ?? 'all'

  useEffect(() => {
    if (params.get('smart') === '1') {
      smartSelect()
      const next = new URLSearchParams(params)
      next.delete('smart')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = useMemo(() => {
    let list = cleanupItems.filter((i) => !i.excluded)
    if (categoryFilter !== 'all') list = list.filter((i) => i.category === categoryFilter)
    if (safetyFilter !== 'all') list = list.filter((i) => i.safety === safetyFilter)

    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'size':
          return b.sizeBytes - a.sizeBytes
        case 'age':
          return b.ageDays - a.ageDays
        case 'safety':
          return SAFETY_ORDER[a.safety] - SAFETY_ORDER[b.safety]
        case 'category':
          return a.category.localeCompare(b.category)
        case 'name':
          return a.name.localeCompare(b.name)
        default:
          return 0
      }
    })
  }, [cleanupItems, categoryFilter, safetyFilter, sortKey])

  function selectAllVisible() {
    selectIds(items.filter((i) => i.safety !== 'red').map((i) => i.id))
  }

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title={t('nav.cleanup')}
        description={t('clean.description')}
        actions={
          <Button variant="secondary" onClick={smartSelect}>
            <Sparkles size={14} />
            {t('clean.smartSelect')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'green', 'orange', 'red'] as const).map((level) => (
          <button
            key={level}
            onClick={() => setSafetyFilter(level)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              safetyFilter === level
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            {level === 'all' ? t('clean.all') : t(`safety.${level}`)}
          </button>
        ))}

        <div className="ms-auto flex flex-wrap items-center gap-2">
          {categoryFilter !== 'all' && (
            <button
              onClick={() => {
                const next = new URLSearchParams(params)
                next.delete('category')
                setParams(next)
              }}
              aria-label={t('clean.clearCategory')}
              className="rounded-full border border-border-strong bg-surface-2 px-3 py-1.5 text-[12px] text-text-muted hover:text-text"
            >
              {t('clean.categoryChip', { category: t(`cat.${categoryFilter}`) })} ✕
            </button>
          )}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
          >
            <option value="size">{t('clean.sort.size')}</option>
            <option value="age">{t('clean.sort.age')}</option>
            <option value="safety">{t('clean.sort.safety')}</option>
            <option value="category">{t('clean.sort.category')}</option>
            <option value="name">{t('clean.sort.name')}</option>
          </select>
          <button
            onClick={selectAllVisible}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-text"
          >
            {t('clean.selectAllVisible')}
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-text"
            >
              {t('clean.clear')}
            </button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={ShieldCheck}
              title={t('clean.emptyTitle')}
              description={t('clean.emptyBody')}
            />
          </CardBody>
        ) : (
          items.map((item) => <CleanupItemRow key={item.id} item={item} />)
        )}
      </Card>
    </div>
  )
}
