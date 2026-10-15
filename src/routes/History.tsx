import { useMemo, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Sparkles, Trophy, ListChecks, Calendar } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAppStore } from '@/store/useAppStore'
import { bytesToGb } from '@/lib/format'
import { useI18n } from '@/i18n'
import { biggestSingleCleanup, sumSavedLifetime, sumSavedWithin } from '@/lib/historyStats'
import { DASHBOARD_CATEGORY_ORDER } from '@/mocks'
import type { StorageCategoryId } from '@/types'
import { clsx } from 'clsx'

type RangeFilter = 'all' | '30' | '90'

export function HistoryPage() {
  const history = useAppStore((s) => s.history)
  const [range, setRange] = useState<RangeFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<StorageCategoryId | 'all'>('all')
  const { t, tp, fmt } = useI18n()
  const formatBytes = (b: number) => fmt.bytes(b)

  const filtered = useMemo(() => {
    let list = [...history]
    if (range !== 'all') {
      const maxDays = Number(range)
      list = list.filter((s) => (Date.now() - new Date(s.completedAt).getTime()) / 86400000 <= maxDays)
    }
    if (categoryFilter !== 'all') {
      list = list.filter((s) => s.categoryBreakdown.some((c) => c.category === categoryFilter))
    }
    return list.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
  }, [history, range, categoryFilter])

  const chartData = useMemo(
    () =>
      [...history]
        .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
        .map((s) => ({
          date: fmt.date(s.completedAt),
          gb: Number(bytesToGb(s.actualBytes).toFixed(1)),
        })),
    [history, fmt],
  )

  const lifetime = sumSavedLifetime(history)
  const thisMonth = sumSavedWithin(history, 30)
  const biggest = biggestSingleCleanup(history)

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        title={t('hist.title')}
        description={t('hist.description')}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardBody>
            <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <Trophy size={12} /> {t('hist.lifetime')}
            </p>
            <p className="mt-1 text-lg font-semibold text-text">{formatBytes(lifetime)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <Calendar size={12} /> {t('hist.thisMonth')}
            </p>
            <p className="mt-1 text-lg font-semibold text-text">{formatBytes(thisMonth)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <ListChecks size={12} /> {t('hist.runs')}
            </p>
            <p className="mt-1 text-lg font-semibold text-text">{fmt.number(history.length)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <Sparkles size={12} /> {t('hist.biggest')}
            </p>
            <p className="mt-1 text-lg font-semibold text-text">{biggest ? formatBytes(biggest.actualBytes) : '—'}</p>
          </CardBody>
        </Card>
      </div>

      {chartData.length > 1 && (
        <Card>
          <CardBody>
            <p className="mb-3 text-[13px] font-medium text-text-muted">{t('hist.chartTitle')}</p>
            <div className="h-52 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="savedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-faint)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-faint)' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                    formatter={(value) => [fmt.bytes(Number(value) * 1e9), t('hist.saved')]}
                  />
                  <Area type="monotone" dataKey="gb" stroke="var(--color-accent)" strokeWidth={2} fill="url(#savedGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['all', '30', '90'] as RangeFilter[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
              range === r ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted hover:text-text',
            )}
          >
            {r === 'all' ? t('hist.allTime') : t('hist.lastDays', { days: fmt.number(Number(r)) })}
          </button>
        ))}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as StorageCategoryId | 'all')}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted"
        >
          <option value="all">{t('hist.allCategories')}</option>
          {DASHBOARD_CATEGORY_ORDER.map((id) => (
            <option key={id} value={id}>
              {t(`cat.${id}`)}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={ListChecks} title={t('hist.emptyTitle')} description={t('hist.emptyBody')} />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((session) => (
            <Card key={session.id}>
              <CardBody className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-text">{fmt.date(session.completedAt)}</p>
                    {session.source === 'scheduled-auto-clean' && (
                      <span className="rounded-full bg-safe-soft px-2 py-0.5 text-[10px] font-medium text-safe">
                        {t('hist.autoClean')}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-text-faint">
                    {tp('cleaned', session.itemCount)}
                    {!!session.failureCount && session.failureCount > 0 && (
                      <span className="text-review"> · {t('hist.failed', { count: fmt.number(session.failureCount) })}</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {session.categoryBreakdown.map((c) => (
                    <span key={c.category} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">
                      {t(`cat.${c.category}`)} · {formatBytes(c.bytes)}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-end">
                  <div>
                    <p className="text-[11px] text-text-faint">{t('hist.beforeAfter')}</p>
                    <p className="text-[12px] text-text-muted">
                      {formatBytes(session.beforeUsedBytes)} → {formatBytes(session.afterUsedBytes)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-text-faint">{t('hist.reclaimed')}</p>
                    <p className="text-[14px] font-semibold text-safe">{formatBytes(session.actualBytes)}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
