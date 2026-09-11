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

type SortKey = 'size' | 'age' | 'safety' | 'category' | 'name'
const SAFETY_ORDER: Record<SafetyLevel, number> = { red: 0, orange: 1, green: 2 }

export function Cleanup() {
  const [params, setParams] = useSearchParams()
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const selectedIds = useAppStore((s) => s.selectedIds)
  const selectIds = useAppStore((s) => s.selectIds)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const smartSelect = useAppStore((s) => s.smartSelect)

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
        title="Cleanup"
        description="Every recommendation shows why it exists and what happens if you clean it — nothing is removed without your review."
        actions={
          <Button variant="secondary" onClick={smartSelect}>
            <Sparkles size={14} />
            Smart Select
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
            {level === 'all' ? 'All' : level === 'green' ? 'Safe' : level === 'orange' ? 'Review' : 'Protected'}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {categoryFilter !== 'all' && (
            <button
              onClick={() => {
                const next = new URLSearchParams(params)
                next.delete('category')
                setParams(next)
              }}
              className="rounded-full border border-border-strong bg-surface-2 px-3 py-1.5 text-[12px] text-text-muted hover:text-text"
            >
              Category: {categoryFilter} ✕
            </button>
          )}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
          >
            <option value="size">Sort: Size</option>
            <option value="age">Sort: Last used</option>
            <option value="safety">Sort: Risk</option>
            <option value="category">Sort: Category</option>
            <option value="name">Sort: Name</option>
          </select>
          <button
            onClick={selectAllVisible}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-text"
          >
            Select all visible
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-text"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={ShieldCheck}
              title="Nothing to clean here"
              description="Try a different filter, or run a new scan to look for more opportunities."
            />
          </CardBody>
        ) : (
          items.map((item) => <CleanupItemRow key={item.id} item={item} />)
        )}
      </Card>
    </div>
  )
}
