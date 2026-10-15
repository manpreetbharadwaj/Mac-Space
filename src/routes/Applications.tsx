import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, HardDrive, Lock, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAppStore } from '@/store/useAppStore'
import { useI18n, type MessageKey } from '@/i18n'
import type { ApplicationItem } from '@/types'
import { clsx } from 'clsx'

type Filter = 'all' | '30' | '90' | 'large' | 'recent'

const FILTERS: { key: Filter; label: MessageKey }[] = [
  { key: 'all', label: 'apps.filter.all' },
  { key: 'recent', label: 'apps.filter.recent' },
  { key: '30', label: 'apps.filter.30' },
  { key: '90', label: 'apps.filter.90' },
  { key: 'large', label: 'apps.filter.large' },
]

const STATUS_META: Record<ApplicationItem['usageStatus'], { label: MessageKey; className: string }> = {
  active: { label: 'apps.status.active', className: 'bg-safe-soft text-safe' },
  infrequent: { label: 'apps.status.infrequent', className: 'bg-review-soft text-review' },
  'not-used': { label: 'apps.status.notUsed', className: 'bg-protected-soft text-protected' },
  unknown: { label: 'apps.status.unknown', className: 'bg-surface-2 text-text-faint' },
}

export function Applications() {
  const applications = useAppStore((s) => s.applications)
  const uninstallApp = useAppStore((s) => s.uninstallApp)
  const dataSource = useAppStore((s) => s.dataSource)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const uninstallAvailable = dataSource === 'mock'
  const { t, fmt } = useI18n()
  const formatBytes = (b: number) => fmt.bytes(b)
  const lastUsedText = (daysAgo: number | null) => (daysAgo === null ? t('apps.unknown') : fmt.relativeDays(daysAgo))

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
        title={t('nav.applications')}
        description={t('apps.description')}
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
            {t(f.label)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <CardBody>
              <EmptyState icon={HardDrive} title={t('apps.noMatchTitle')} description={t('apps.noMatchBody')} />
            </CardBody>
          ) : (
            <div>
              {filtered.map((app) => (
                <button
                  key={app.id}
                  onClick={() => setSelectedId(app.id)}
                  className={clsx(
                    'flex w-full items-center gap-3 border-b border-border px-4 py-3 text-start transition-colors last:border-0 hover:bg-surface-2',
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
                    <p className="text-[12px] text-text-faint">{t('apps.used', { when: lastUsedText(app.lastUsedDaysAgo) })}</p>
                  </div>
                  <span
                    className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_META[app.usageStatus].className)}
                  >
                    {t(STATUS_META[app.usageStatus].label)}
                  </span>
                  <p className="w-16 shrink-0 text-end text-[13px] font-medium text-text">{formatBytes(app.sizeBytes)}</p>
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
                    {t(STATUS_META[selected.usageStatus].label)}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-2.5 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <HardDrive size={13} /> {t('apps.appSize')}
                  </span>
                  <span className="font-medium text-text">{formatBytes(selected.sizeBytes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <Clock size={13} /> {t('apps.lastUsed')}
                  </span>
                  <span className="font-medium text-text">{lastUsedText(selected.lastUsedDaysAgo)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <CheckCircle2 size={13} /> {t('apps.associated')}
                  </span>
                  <span className="font-medium text-text">{formatBytes(selected.associatedCleanupBytes)}</span>
                </div>
              </div>

              <p className="mt-3 rounded-lg bg-surface-2 p-2.5 text-[12px] text-text-muted">
                {t('apps.supportNote')}
              </p>

              <Button
                variant={uninstallAvailable ? 'danger' : 'secondary'}
                className="mt-4 w-full"
                disabled={!uninstallAvailable}
                onClick={() => setConfirmOpen(true)}
              >
                {uninstallAvailable ? <Trash2 size={14} /> : <Lock size={14} />}
                {uninstallAvailable ? t('apps.reviewUninstall') : t('apps.availableLater')}
              </Button>
            </CardBody>
          ) : (
            <CardBody>
              <EmptyState icon={HardDrive} title={t('apps.noSelTitle')} description={t('apps.noSelBody')} />
            </CardBody>
          )}
        </Card>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('apps.uninstallTitle')} width="sm">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-review-soft p-3 text-[12px] text-text">
              <AlertTriangle size={15} className="shrink-0 text-review" />
              {t('apps.uninstallBody', { app: selected.name, size: formatBytes(selected.sizeBytes + selected.associatedCleanupBytes) })}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => confirmUninstall(selected)}>
                {t('apps.uninstall')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
