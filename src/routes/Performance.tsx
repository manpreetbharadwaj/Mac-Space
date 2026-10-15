import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, MemoryStick, Cpu, Server, Gauge } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { InfoRow } from '@/components/ui/InfoRow'
import { Segmented } from '@/components/ui/Segmented'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { UsageChart } from '@/components/performance/UsageChart'
import { MeterBar } from '@/components/performance/MeterBar'
import { AlertBanner } from '@/components/performance/AlertBanner'
import { ProcessManager } from '@/components/performance/ProcessManager'
import { useAppStore } from '@/store/useAppStore'
import { usePolling } from '@/hooks/usePolling'
import { isTauriRuntime } from '@/services/environment'
import { getPerformanceSnapshot, setPerformanceViewActive } from '@/services/tauri/bridge'
import type { PressureLevel, RawPerformanceSnapshot } from '@/services/tauri/systemTypes'
import { useI18n } from '@/i18n'

type Tab = 'overview' | 'processes'

const PRESSURE_TONE: Record<PressureLevel, StatusTone> = { normal: 'good', elevated: 'fair', critical: 'attention' }

/** Fixed palette for the memory composition — chosen to read in both themes. */
const MEMORY_COLORS = { app: '#0a7cff', wired: '#d97706', compressed: '#a855f7', cached: '#94a3b8' }

function BigStat({ value, caption, className }: { value: string; caption?: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-text">{value}</p>
      {caption && <p className="mt-1.5 text-[12px] text-text-muted">{caption}</p>}
    </div>
  )
}

function SplitBar({ items }: { items: { label: string; value: number | null; color: string }[] }) {
  const { fmt } = useI18n()
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 text-[12px]">
          <span className="w-20 shrink-0 text-text-muted">{item.label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, item.value ?? 0)}%`, background: item.color }} />
          </div>
          <span className="w-12 shrink-0 text-end tabular-nums font-medium text-text">{item.value === null ? '—' : fmt.percent(item.value, 0)}</span>
        </div>
      ))}
    </div>
  )
}

export function PerformancePage() {
  const { t, fmt } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'processes' ? 'processes' : 'overview'
  const setTab = (next: Tab) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true })
  const [snapshot, setSnapshot] = useState<RawPerformanceSnapshot | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const desktop = isTauriRuntime()
  const perf = settings?.performance
  const intervalMs = (perf?.refreshIntervalSec ?? 2) * 1000

  // Tells the native sampler this screen is visible, so it samples at the
  // fast interval only while someone is looking (see performance.rs).
  useEffect(() => {
    if (!desktop) return
    void setPerformanceViewActive(true)
    return () => void setPerformanceViewActive(false)
  }, [desktop])

  const poll = useCallback(async () => {
    try {
      setSnapshot(await getPerformanceSnapshot())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])
  usePolling(poll, desktop && perf?.monitoringEnabled && tab === 'overview' ? intervalMs : null)
  // Alerts stay visible on the processes tab too, at a slower pace.
  usePolling(poll, desktop && perf?.monitoringEnabled && tab === 'processes' ? Math.max(intervalMs, 5000) : null)

  const header = (
    <PageHeader
      title={t('perf.title')}
      description={t('perf.description')}
      actions={
        desktop && perf?.monitoringEnabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-safe" aria-hidden />
            {t('perf.refreshEvery', { seconds: perf.refreshIntervalSec })}
          </span>
        ) : undefined
      }
    />
  )

  if (!desktop) {
    return (
      <div>
        {header}
        <EmptyState icon={Activity} title={t('common.desktopOnlyTitle')} description={t('common.desktopOnlyBody')} />
      </div>
    )
  }

  if (settings && !settings.performance.monitoringEnabled) {
    return (
      <div>
        {header}
        <EmptyState
          icon={Gauge}
          title={t('perf.off.title')}
          description={t('perf.off.body')}
          action={
            <Button variant="primary" size="sm" onClick={() => saveSettings({ ...settings, performance: { ...settings.performance, monitoringEnabled: true } })}>
              {t('perf.off.action')}
            </Button>
          }
        />
      </div>
    )
  }

  const m = snapshot?.memory ?? null
  const cpu = snapshot?.cpu
  const sys = snapshot?.system
  const windowMs = snapshot && snapshot.history.length > 1 ? Math.max(60_000, snapshot.history[snapshot.history.length - 1].t - snapshot.history[0].t) : 5 * 60_000
  const windowMinutes = Math.max(1, Math.round(windowMs / 60_000))
  const unavailable = <span className="font-normal text-text-faint">{t('common.unavailable')}</span>
  const pressureLabel = (p: PressureLevel) => t(`perf.pressure.${p}`)

  const battery = sys?.battery
  const powerValue = !battery
    ? unavailable
    : !battery.present
      ? `${t('perf.system.noBattery')} · ${t('perf.system.onAdapter')}`
      : [
          battery.percent !== null ? t('perf.system.batteryPercent', { percent: fmt.percent(battery.percent) }) : null,
          battery.isCharging ? t('perf.system.charging') : battery.powerSource === 'Battery Power' ? t('perf.system.onBattery') : t('perf.system.onAdapter'),
          battery.lowPowerMode ? t('perf.system.lowPower') : null,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className="space-y-5 pb-10">
      {header}

      <Segmented
        label={t('perf.title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: t('perf.tab.overview') },
          { value: 'processes', label: t('perf.tab.processes') },
        ]}
      />

      {error && <p className="rounded-lg bg-protected-soft p-2.5 text-[12px] text-text">{t('common.error', { error })}</p>}

      {snapshot && (
        <AlertBanner
          alerts={snapshot.alerts}
          onReviewApps={() => setTab('processes')}
          notificationUnavailable={snapshot.lastNotificationError === 'unavailable'}
        />
      )}

      {tab === 'processes' ? (
        <ProcessManager refreshIntervalMs={intervalMs} />
      ) : snapshot === undefined ? (
        <p className="py-16 text-center text-[13px] text-text-faint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MemoryStick size={16} className="text-text-faint" />
                  {t('perf.memory.title')}
                </CardTitle>
                {m?.pressure && <StatusChip tone={PRESSURE_TONE[m.pressure]} label={`${t('perf.memory.pressure')}: ${pressureLabel(m.pressure)}`} />}
              </CardHeader>
              <CardBody className="space-y-4">
                {m ? (
                  <>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <BigStat value={fmt.percent(m.usedPercent)} caption={t('perf.memory.usedOf', { used: fmt.bytes(m.usedBytes), total: fmt.bytes(m.totalBytes, 0) })} />
                      {m.pressure && <p className="max-w-[260px] text-end text-[12px] text-text-muted">{t(`perf.pressure.hint.${m.pressure}`)}</p>}
                    </div>
                    <MeterBar
                      total={m.totalBytes}
                      formatValue={(v) => fmt.bytes(v)}
                      segments={[
                        { key: 'app', label: t('perf.memory.app'), value: m.appBytes, color: MEMORY_COLORS.app },
                        { key: 'wired', label: t('perf.memory.wired'), value: m.wiredBytes, color: MEMORY_COLORS.wired },
                        { key: 'compressed', label: t('perf.memory.compressed'), value: m.compressedBytes, color: MEMORY_COLORS.compressed },
                        { key: 'cached', label: t('perf.memory.cached'), value: m.cachedFilesBytes, color: MEMORY_COLORS.cached },
                      ]}
                    />
                    <p className="text-[11px] text-text-faint">{t('perf.memory.cachedHint')}</p>
                    <div className="divide-y divide-border border-t border-border">
                      <InfoRow label={t('perf.memory.total')} value={fmt.bytes(m.totalBytes, 0)} />
                      <InfoRow label={t('perf.memory.used')} value={fmt.bytes(m.usedBytes)} />
                      <InfoRow label={t('perf.memory.available')} value={fmt.bytes(m.availableBytes)} />
                      <InfoRow label={t('perf.memory.freePercent')} value={m.freePercent === null ? unavailable : fmt.percent(m.freePercent)} />
                      <InfoRow
                        label={t('perf.memory.swap')}
                        value={m.swapUsedBytes === null ? unavailable : `${fmt.bytes(m.swapUsedBytes)}${m.swapTotalBytes ? ` / ${fmt.bytes(m.swapTotalBytes)}` : ''}`}
                      />
                      <InfoRow
                        label={t('perf.memory.swapActivity')}
                        value={m.swapOutsPerSec === null ? '—' : m.swapOutsPerSec > 0 || (m.swapInsPerSec ?? 0) > 0 ? t('common.yes') : t('common.no')}
                      />
                    </div>
                  </>
                ) : (
                  unavailable
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu size={16} className="text-text-faint" />
                  {t('perf.cpu.title')}
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <BigStat value={cpu?.usagePercent == null ? '—' : fmt.percent(cpu.usagePercent)} caption={cpu?.usagePercent == null ? t('proc.measuring') : t('perf.cpu.usage')} />
                <SplitBar
                  items={[
                    { label: t('perf.cpu.user'), value: cpu?.userPercent ?? null, color: '#0a7cff' },
                    { label: t('perf.cpu.system'), value: cpu?.systemPercent ?? null, color: '#ef4444' },
                    { label: t('perf.cpu.idle'), value: cpu?.idlePercent ?? null, color: '#94a3b8' },
                  ]}
                />
                <div className="divide-y divide-border border-t border-border">
                  <InfoRow
                    label={t('perf.cpu.cores')}
                    value={cpu?.physicalCores && cpu.logicalCores ? t('perf.cpu.coresValue', { physical: cpu.physicalCores, logical: cpu.logicalCores }) : unavailable}
                  />
                  <InfoRow label={t('perf.cpu.load')} value={cpu?.loadAverage ? cpu.loadAverage.map((v) => fmt.number(v, 2)).join(' · ') : unavailable} />
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {(
              [
                { key: 'memory', label: t('perf.chart.memory'), color: '#0a7cff', points: snapshot?.history.map((h) => ({ t: h.t, v: h.memoryPercent })) ?? [] },
                { key: 'cpu', label: t('perf.chart.cpu'), color: '#a855f7', points: snapshot?.history.map((h) => ({ t: h.t, v: h.cpuPercent })) ?? [] },
              ] as const
            ).map((chart) => {
              const last = chart.points.length ? chart.points[chart.points.length - 1].v : null
              return (
                <Card key={chart.key}>
                  <CardHeader>
                    <CardTitle>{chart.label}</CardTitle>
                    <span className="text-[12px] text-text-faint">{t('perf.chart.window', { minutes: windowMinutes })}</span>
                  </CardHeader>
                  <CardBody>
                    <UsageChart
                      points={chart.points}
                      windowMs={windowMs}
                      color={chart.color}
                      label={`${chart.label}: ${last === null ? '—' : fmt.percent(last)}`}
                      emptyLabel={t('perf.chart.collecting')}
                    />
                  </CardBody>
                </Card>
              )
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server size={16} className="text-text-faint" />
                {t('perf.system.title')}
              </CardTitle>
            </CardHeader>
            <CardBody className="grid gap-x-8 md:grid-cols-2">
              <div className="divide-y divide-border">
                <InfoRow
                  label={t('perf.system.processes')}
                  hint={t('perf.system.breakdownHint')}
                  value={
                    sys?.processCount == null ? (
                      unavailable
                    ) : (
                      <span>
                        {fmt.number(sys.processCount)}
                        <span className="block text-[11px] font-normal text-text-faint">
                          {t('perf.system.breakdown', { apps: sys.appCount ?? 0, background: sys.backgroundCount ?? 0, system: sys.systemCount ?? 0 })}
                        </span>
                      </span>
                    )
                  }
                />
                <InfoRow label={t('perf.system.uptime')} value={sys?.uptimeSecs == null ? unavailable : fmt.duration(sys.uptimeSecs)} />
                <InfoRow label={t('perf.system.power')} value={powerValue} />
              </div>
              <div className="divide-y divide-border">
                <InfoRow
                  label={t('perf.system.disk')}
                  value={sys ? t('perf.system.diskValue', { used: fmt.bytes(sys.diskUsedBytes), total: fmt.bytes(sys.diskTotalBytes, 0) }) : unavailable}
                />
                <InfoRow
                  label={t('perf.system.diskActivity')}
                  hint={t('perf.system.diskActivityHint')}
                  value={
                    sys?.diskReadBytesPerSec == null || sys.diskWriteBytesPerSec == null
                      ? <span className="font-normal text-text-faint">{t('proc.measuring')}</span>
                      : t('perf.system.diskActivityValue', { read: fmt.bytes(sys.diskReadBytesPerSec), write: fmt.bytes(sys.diskWriteBytesPerSec) })
                  }
                />
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
