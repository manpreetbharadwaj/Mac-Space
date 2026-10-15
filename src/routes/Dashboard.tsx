import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles, ScanLine, HardDriveDownload, Code2, Globe, AppWindow, Download, Files as FilesIcon, Cpu, ArrowRight, Clock, CalendarClock, Trophy, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SegmentedBar } from '@/components/ui/ProgressBar'
import { useAppStore } from '@/store/useAppStore'
import { useI18n } from '@/i18n'
import { CATEGORY_COLOR } from '@/lib/categoryMeta'
import { sumSavedWithin, sumSavedLifetime } from '@/lib/historyStats'
import type { MessageKey } from '@/i18n/core'

function CategoryPill({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

interface QuickCard {
  key: string
  label: MessageKey
  icon: typeof Code2
  bytes: number
  itemCount: number
  route: string
  accent: string
}

export function Dashboard() {
  const navigate = useNavigate()
  const diskSummary = useAppStore((s) => s.diskSummary)
  const categories = useAppStore((s) => s.categories)
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const applications = useAppStore((s) => s.applications)
  const history = useAppStore((s) => s.history)
  const schedule = useAppStore((s) => s.schedule)
  const scanSession = useAppStore((s) => s.scanSession)
  const { t, tp, fmt } = useI18n()

  const quickCards: QuickCard[] = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const unusedApps = applications.filter((a) => a.usageStatus !== 'active')
    const largeFiles = cleanupItems.filter((i) => i.fileKind === 'large' && !i.excluded)

    return [
      {
        key: 'developer',
        label: 'dash.card.developer',
        icon: Code2,
        bytes: byId.get('developer')?.reclaimableBytes ?? 0,
        itemCount: cleanupItems.filter((i) => i.category === 'developer' && !i.excluded).length,
        route: '/developer',
        accent: CATEGORY_COLOR.developer,
      },
      {
        key: 'browser',
        label: 'dash.card.browser',
        icon: Globe,
        bytes: byId.get('browser')?.reclaimableBytes ?? 0,
        itemCount: cleanupItems.filter((i) => i.category === 'browser' && !i.excluded).length,
        route: '/browsers',
        accent: CATEGORY_COLOR.browser,
      },
      {
        key: 'applications',
        label: 'dash.card.applications',
        icon: AppWindow,
        bytes: unusedApps.reduce((sum, a) => sum + a.associatedCleanupBytes, 0),
        itemCount: unusedApps.length,
        route: '/applications',
        accent: CATEGORY_COLOR.applications,
      },
      {
        key: 'downloads',
        label: 'dash.card.downloads',
        icon: Download,
        bytes: byId.get('downloads')?.reclaimableBytes ?? 0,
        itemCount: cleanupItems.filter((i) => i.category === 'downloads' && !i.excluded).length,
        route: '/files?tab=downloads',
        accent: CATEGORY_COLOR.downloads,
      },
      {
        key: 'large-files',
        label: 'dash.card.large',
        icon: FilesIcon,
        bytes: largeFiles.reduce((sum, i) => sum + i.sizeBytes, 0),
        itemCount: largeFiles.length,
        route: '/files?tab=large',
        accent: '#64748b',
      },
      {
        key: 'system',
        label: 'dash.card.system',
        icon: Cpu,
        bytes: byId.get('system')?.reclaimableBytes ?? 0,
        itemCount: cleanupItems.filter((i) => i.category === 'system' && !i.excluded).length,
        route: '/cleanup?category=system',
        accent: CATEGORY_COLOR.system,
      },
    ]
  }, [categories, cleanupItems, applications])

  const savedToday = history.length ? sumSavedWithin(history, 1) : 0
  const saved7 = sumSavedWithin(history, 7)
  const saved30 = sumSavedWithin(history, 30)
  const savedLifetime = sumSavedLifetime(history)
  const lastCleanup = history[0] ?? null

  if (!diskSummary) return null

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.dashboard')}
        description={t('dash.description')}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/files?tab=large')}>
              {t('dash.findLarge')}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/cleanup')}>
              {t('dash.reviewCleanup')}
            </Button>
            <Button variant="primary" onClick={() => navigate('/scan')}>
              <ScanLine size={15} />
              {t('dash.scanNow')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] text-text-muted">{t('dash.storageOverview')}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-text">
                  {fmt.bytes(diskSummary.usedBytes)}{' '}
                  <span className="text-base font-normal text-text-muted">
                    {t('dash.usedOf', { total: fmt.bytes(diskSummary.totalBytes) })}
                  </span>
                </p>
              </div>
              <div className="text-end">
                <p className="text-[13px] text-text-muted">{t('dash.reclaimable')}</p>
                <p className="mt-1 text-2xl font-semibold text-safe">{fmt.bytes(diskSummary.reclaimableBytes)}</p>
              </div>
            </div>

            <div className="mt-5">
              <SegmentedBar
                segments={categories.map((c) => ({
                  value: c.usedBytes,
                  color: CATEGORY_COLOR[c.id],
                  label: `${t(`cat.${c.id}`)}: ${fmt.bytes(c.usedBytes)}`,
                }))}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {categories.map((c) => (
                <CategoryPill key={c.id} label={t(`cat.${c.id}`)} color={CATEGORY_COLOR[c.id]} />
              ))}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-faint">{t('dash.totalCapacity')}</p>
                <p className="mt-0.5 text-sm font-medium text-text">{fmt.bytes(diskSummary.totalBytes)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-faint">{t('dash.used')}</p>
                <p className="mt-0.5 text-sm font-medium text-text">{fmt.bytes(diskSummary.usedBytes)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-faint">{t('dash.available')}</p>
                <p className="mt-0.5 text-sm font-medium text-text">{fmt.bytes(diskSummary.freeBytes)}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-[11px] text-text-faint">
                {t('dash.diskUsedPct', { percent: fmt.percent(diskSummary.totalBytes > 0 ? (diskSummary.usedBytes / diskSummary.totalBytes) * 100 : 0) })}
                {diskSummary.purgeableBytes !== null && diskSummary.purgeableBytes > 0 && (
                  <> · {t('dash.purgeable', { size: fmt.bytes(diskSummary.purgeableBytes) })}</>
                )}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-text-faint" title={t('dash.differsHint')}>
                <Info size={11} className="shrink-0" />
                {t('dash.differs')}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-2 text-[13px] text-text-muted">
              <Trophy size={15} />
              {t('dash.spaceSaved')}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {[
                [t('dash.today'), savedToday],
                [t('dash.days7'), saved7],
                [t('dash.days30'), saved30],
                [t('dash.lifetime'), savedLifetime],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl bg-surface-2 p-3">
                  <p className="text-[11px] text-text-faint">{label}</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-text">{fmt.bytes(value as number)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t border-border pt-3 text-[12px] text-text-muted">
              <div className="flex items-center gap-2">
                <Clock size={13} />
                {t('dash.lastScan', { value: scanSession?.completedAt ? fmt.dateTimeIso(scanSession.completedAt) : t('dash.never') })}
              </div>
              <div className="flex items-center gap-2">
                <HardDriveDownload size={13} />
                {t('dash.lastCleanup', { value: lastCleanup ? fmt.bytes(lastCleanup.actualBytes) : t('dash.noneYet') })}
              </div>
              <div className="flex items-center gap-2">
                <CalendarClock size={13} />
                {t('dash.nextScan', {
                  value: schedule?.enabled && schedule.nextRunAt ? fmt.dateTimeIso(schedule.nextRunAt) : t('dash.notScheduled'),
                })}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-[13px] font-semibold text-text-muted">{t('dash.opportunities')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickCards.map((card, i) => (
            <motion.button
              key={card.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => navigate(card.route)}
              className="group text-start"
            >
              <Card className="h-full transition-colors group-hover:border-border-strong">
                <CardBody>
                  <div className="flex items-center justify-between">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-lg"
                      style={{ background: `${card.accent}1a`, color: card.accent }}
                    >
                      <card.icon size={17} />
                    </div>
                    <ArrowRight size={15} className="text-text-faint transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                  </div>
                  <p className="mt-3 text-[13px] text-text-muted">{t(card.label)}</p>
                  <p className="mt-0.5 text-xl font-semibold text-text">{fmt.bytes(card.bytes)}</p>
                  <p className="mt-0.5 text-[12px] text-text-faint">{tp('items', card.itemCount)}</p>
                </CardBody>
              </Card>
            </motion.button>
          ))}
        </div>
      </div>

      <Card className="border-dashed">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Sparkles size={17} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-text">{t('dash.smartReady')}</p>
              <p className="text-[12px] text-text-muted">
                {t('dash.smartBody')}
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => navigate('/cleanup?smart=1')}>
            {t('dash.trySmart')}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
