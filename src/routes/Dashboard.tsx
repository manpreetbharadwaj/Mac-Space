import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles, ScanLine, HardDriveDownload, Code2, Globe, AppWindow, Download, Files as FilesIcon, Cpu, ArrowRight, Clock, CalendarClock, Trophy, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SegmentedBar } from '@/components/ui/ProgressBar'
import { useAppStore } from '@/store/useAppStore'
import { formatBytes, formatDateTime, formatPercent } from '@/lib/format'
import { CATEGORY_COLOR } from '@/lib/categoryMeta'
import { sumSavedWithin, sumSavedLifetime } from '@/lib/historyStats'

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
  label: string
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

  const quickCards: QuickCard[] = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const unusedApps = applications.filter((a) => a.usageStatus !== 'active')
    const largeFiles = cleanupItems.filter((i) => i.fileKind === 'large' && !i.excluded)

    return [
      {
        key: 'developer',
        label: 'Developer Junk',
        icon: Code2,
        bytes: byId.get('developer')?.reclaimableBytes ?? 0,
        itemCount: cleanupItems.filter((i) => i.category === 'developer' && !i.excluded).length,
        route: '/developer',
        accent: CATEGORY_COLOR.developer,
      },
      {
        key: 'browser',
        label: 'Browser Cache',
        icon: Globe,
        bytes: byId.get('browser')?.reclaimableBytes ?? 0,
        itemCount: cleanupItems.filter((i) => i.category === 'browser' && !i.excluded).length,
        route: '/browsers',
        accent: CATEGORY_COLOR.browser,
      },
      {
        key: 'applications',
        label: 'Unused Apps',
        icon: AppWindow,
        bytes: unusedApps.reduce((sum, a) => sum + a.associatedCleanupBytes, 0),
        itemCount: unusedApps.length,
        route: '/applications',
        accent: CATEGORY_COLOR.applications,
      },
      {
        key: 'downloads',
        label: 'Downloads',
        icon: Download,
        bytes: byId.get('downloads')?.reclaimableBytes ?? 0,
        itemCount: cleanupItems.filter((i) => i.category === 'downloads' && !i.excluded).length,
        route: '/files?tab=downloads',
        accent: CATEGORY_COLOR.downloads,
      },
      {
        key: 'large-files',
        label: 'Large Files',
        icon: FilesIcon,
        bytes: largeFiles.reduce((sum, i) => sum + i.sizeBytes, 0),
        itemCount: largeFiles.length,
        route: '/files?tab=large',
        accent: '#64748b',
      },
      {
        key: 'system',
        label: 'System Caches',
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
        title="Dashboard"
        description="Know what is using your Mac storage, understand whether it's safe to remove, and reclaim space without fear."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/files?tab=large')}>
              Find Large Files
            </Button>
            <Button variant="secondary" onClick={() => navigate('/cleanup')}>
              Review Cleanup
            </Button>
            <Button variant="primary" onClick={() => navigate('/scan')}>
              <ScanLine size={15} />
              Scan Now
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] text-text-muted">Storage overview</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-text">
                  {formatBytes(diskSummary.usedBytes)}{' '}
                  <span className="text-base font-normal text-text-muted">
                    used of {formatBytes(diskSummary.totalBytes)}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[13px] text-text-muted">Potentially reclaimable</p>
                <p className="mt-1 text-2xl font-semibold text-safe">{formatBytes(diskSummary.reclaimableBytes)}</p>
              </div>
            </div>

            <div className="mt-5">
              <SegmentedBar
                segments={categories.map((c) => ({
                  value: c.usedBytes,
                  color: CATEGORY_COLOR[c.id],
                  label: `${c.label}: ${formatBytes(c.usedBytes)}`,
                }))}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {categories.map((c) => (
                <CategoryPill key={c.id} label={c.label} color={CATEGORY_COLOR[c.id]} />
              ))}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-faint">Total capacity</p>
                <p className="mt-0.5 text-sm font-medium text-text">{formatBytes(diskSummary.totalBytes)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-faint">Used</p>
                <p className="mt-0.5 text-sm font-medium text-text">{formatBytes(diskSummary.usedBytes)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-faint">Available</p>
                <p className="mt-0.5 text-sm font-medium text-text">{formatBytes(diskSummary.freeBytes)}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-[11px] text-text-faint">
                {formatPercent(diskSummary.usedBytes, diskSummary.totalBytes)} of disk used
                {diskSummary.purgeableBytes !== null && diskSummary.purgeableBytes > 0 && (
                  <> · includes {formatBytes(diskSummary.purgeableBytes)} purgeable space macOS can reclaim automatically</>
                )}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-text-faint" title="macOS may report slightly different storage values because APFS snapshots, purgeable space, and system-reserved storage are calculated separately.">
                <Info size={11} className="shrink-0" />
                May differ slightly from System Settings
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-2 text-[13px] text-text-muted">
              <Trophy size={15} />
              Space saved
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {[
                ['Today', savedToday],
                ['7 days', saved7],
                ['30 days', saved30],
                ['Lifetime', savedLifetime],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl bg-surface-2 p-3">
                  <p className="text-[11px] text-text-faint">{label}</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-text">{formatBytes(value as number)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t border-border pt-3 text-[12px] text-text-muted">
              <div className="flex items-center gap-2">
                <Clock size={13} />
                Last scan: {scanSession?.completedAt ? formatDateTime(scanSession.completedAt) : 'Never'}
              </div>
              <div className="flex items-center gap-2">
                <HardDriveDownload size={13} />
                Last cleanup: {lastCleanup ? formatBytes(lastCleanup.actualBytes) : 'None yet'}
              </div>
              <div className="flex items-center gap-2">
                <CalendarClock size={13} />
                Next scheduled scan:{' '}
                {schedule?.enabled && schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : 'Not scheduled'}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-[13px] font-semibold text-text-muted">Cleanup opportunities</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickCards.map((card, i) => (
            <motion.button
              key={card.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => navigate(card.route)}
              className="group text-left"
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
                    <ArrowRight size={15} className="text-text-faint transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-3 text-[13px] text-text-muted">{card.label}</p>
                  <p className="mt-0.5 text-xl font-semibold text-text">{formatBytes(card.bytes)}</p>
                  <p className="mt-0.5 text-[12px] text-text-faint">{card.itemCount} items</p>
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
              <p className="text-[13px] font-medium text-text">Smart Select is ready</p>
              <p className="text-[12px] text-text-muted">
                Preselect every item marked Safe, then review before cleaning.
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => navigate('/cleanup?smart=1')}>
            Try Smart Select
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
