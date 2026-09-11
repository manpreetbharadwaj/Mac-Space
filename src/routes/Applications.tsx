import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, HardDrive, Lock, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAppStore } from '@/store/useAppStore'
import { formatBytes, formatRelativeDays } from '@/lib/format'
import type { ApplicationItem } from '@/types'
import { clsx } from 'clsx'

type Filter = 'all' | '30' | '90' | 'large' | 'recent'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'recent', label: 'Recently Used' },
  { key: '30', label: 'Not Used 30+ Days' },
  { key: '90', label: 'Not Used 90+ Days' },
  { key: 'large', label: 'Large Apps' },
]

const STATUS_META = {
  active: { label: 'Active', className: 'bg-safe-soft text-safe' },
  infrequent: { label: 'Infrequent', className: 'bg-review-soft text-review' },
  'not-used': { label: 'Not Used Recently', className: 'bg-protected-soft text-protected' },
  unknown: { label: 'Last use unknown', className: 'bg-surface-2 text-text-faint' },
} as const

function lastUsedText(daysAgo: number | null): string {
  return daysAgo === null ? 'Unknown' : formatRelativeDays(daysAgo)
}

export function Applications() {
  const applications = useAppStore((s) => s.applications)
  const uninstallApp = useAppStore((s) => s.uninstallApp)
  const dataSource = useAppStore((s) => s.dataSource)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const uninstallAvailable = dataSource === 'mock'

  const filtered = useMemo(() => {
    let list = [...applications]
    // Apps with no reliably-known last-used date are excluded from the day
    // filters rather than fabricating whether they qualify.
    if (filter === '30') list = list.filter((a) => a.lastUsedDaysAgo !== null && a.lastUsedDaysAgo >= 30)
    if (filter === '90') list = list.filter((a) => a.lastUsedDaysAgo !== null && a.lastUsedDaysAgo >= 90)
    if (filter === 'large') list = list.filter((a) => a.sizeBytes >= 1000 ** 3)
    if (filter === 'recent') list = list.filter((a) => a.usageStatus === 'active')
    return list.sort((a, b) => b.sizeBytes - a.sizeBytes)
  }, [applications, filter])

  const selected = applications.find((a) => a.id === selectedId) ?? filtered[0] ?? null

  async function confirmUninstall(app: ApplicationItem) {
    await uninstallApp(app.id)
    setConfirmOpen(false)
    setSelectedId(null)
  }

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        title="Applications"
        description="See how much space every app takes up and when you last used it — nothing uninstalls without your confirmation."
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
              filter === f.key ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted hover:text-text',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <CardBody>
              <EmptyState icon={HardDrive} title="No apps match this filter" description="Try a different filter above." />
            </CardBody>
          ) : (
            <div>
              {filtered.map((app) => (
                <button
                  key={app.id}
                  onClick={() => setSelectedId(app.id)}
                  className={clsx(
                    'flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2',
                    selected?.id === app.id && 'bg-surface-2',
                  )}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white"
                    style={{ background: app.accent }}
                  >
                    {app.initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-text">{app.name}</p>
                    <p className="text-[12px] text-text-faint">Used {lastUsedText(app.lastUsedDaysAgo)}</p>
                  </div>
                  <span
                    className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_META[app.usageStatus].className)}
                  >
                    {STATUS_META[app.usageStatus].label}
                  </span>
                  <p className="w-16 shrink-0 text-right text-[13px] font-medium text-text">{formatBytes(app.sizeBytes)}</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="h-fit">
          {selected ? (
            <CardBody>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[15px] font-semibold text-white"
                  style={{ background: selected.accent }}
                >
                  {selected.initial}
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-text">{selected.name}</p>
                  <span
                    className={clsx(
                      'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                      STATUS_META[selected.usageStatus].className,
                    )}
                  >
                    {STATUS_META[selected.usageStatus].label}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-2.5 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <HardDrive size={13} /> App size
                  </span>
                  <span className="font-medium text-text">{formatBytes(selected.sizeBytes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <Clock size={13} /> Last used
                  </span>
                  <span className="font-medium text-text">{lastUsedText(selected.lastUsedDaysAgo)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <CheckCircle2 size={13} /> Associated cleanup
                  </span>
                  <span className="font-medium text-text">{formatBytes(selected.associatedCleanupBytes)}</span>
                </div>
              </div>

              <p className="mt-3 rounded-lg bg-surface-2 p-2.5 text-[12px] text-text-muted">
                Support files, caches, and preferences may be shared with other apps — review before removing.
              </p>

              <Button
                variant={uninstallAvailable ? 'danger' : 'secondary'}
                className="mt-4 w-full"
                disabled={!uninstallAvailable}
                onClick={() => setConfirmOpen(true)}
              >
                {uninstallAvailable ? <Trash2 size={14} /> : <Lock size={14} />}
                {uninstallAvailable ? 'Review Uninstall' : 'Available in Safe Cleanup Phase'}
              </Button>
            </CardBody>
          ) : (
            <CardBody>
              <EmptyState icon={HardDrive} title="No app selected" description="Choose an app from the list to see details." />
            </CardBody>
          )}
        </Card>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Uninstall application" width="sm">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-review-soft p-3 text-[12px] text-text">
              <AlertTriangle size={15} className="shrink-0 text-review" />
              This will move "{selected.name}" to the Trash and free approximately{' '}
              {formatBytes(selected.sizeBytes + selected.associatedCleanupBytes)}. This is simulated — no real
              application is changed in this prototype.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => confirmUninstall(selected)}>
                Uninstall
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
