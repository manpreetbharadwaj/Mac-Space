import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeartPulse, Laptop, HardDrive, BatteryMedium, BatteryWarning, RefreshCw, Eye, EyeOff, Copy, Check, ArrowRight, Lightbulb } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { InfoRow } from '@/components/ui/InfoRow'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { useAppStore } from '@/store/useAppStore'
import { usePolling } from '@/hooks/usePolling'
import { isTauriRuntime } from '@/services/environment'
import { getBatteryHealth, getDeviceInfo, getPerformanceSnapshot, getStorageHealth, revealSerialNumber } from '@/services/tauri/bridge'
import type { RawBattery, RawDeviceInfo, RawPerformanceSnapshot, RawStorageHealth } from '@/services/tauri/systemTypes'
import { useI18n, type MessageKey } from '@/i18n'

const MASKED_SERIAL = '••••••••••'

interface SummaryItem {
  key: string
  label: string
  value: ReactNode
  tone: StatusTone | null
}

function statusLabel(tone: StatusTone, t: (k: MessageKey) => string) {
  return tone === 'good' ? t('health.status.good') : tone === 'fair' ? t('health.status.fair') : tone === 'attention' ? t('health.status.attention') : t('health.status.info')
}

/** Shown only after an explicit click; held in this component's state alone — never the store, logs, or disk. */
function SerialNumber() {
  const { t } = useI18n()
  const [serial, setSerial] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <span className="font-mono tabular-nums">{serial ?? MASKED_SERIAL}</span>
      {serial ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            aria-label={t('common.copy')}
            title={t('common.copy')}
            onClick={() => {
              void navigator.clipboard.writeText(serial).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSerial(null)} aria-label={t('common.hide')} title={t('common.hide')}>
            <EyeOff size={13} />
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => void revealSerialNumber().then((s) => setSerial(s ?? null))}
          aria-label={t('common.reveal')}
          title={t('common.reveal')}
        >
          <Eye size={13} />
          {t('common.reveal')}
        </Button>
      )}
    </span>
  )
}

export function MacHealthPage() {
  const { t, fmt } = useI18n()
  const navigate = useNavigate()
  const monitoringEnabled = useAppStore((s) => s.settings?.performance.monitoringEnabled ?? true)
  const desktop = isTauriRuntime()
  const [device, setDevice] = useState<RawDeviceInfo | null>(null)
  const [storage, setStorage] = useState<RawStorageHealth | null>(null)
  const [battery, setBattery] = useState<RawBattery | null>(null)
  const [snapshot, setSnapshot] = useState<RawPerformanceSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadStatic = useCallback(async () => {
    setLoading(true)
    try {
      const [d, s, b] = await Promise.all([getDeviceInfo(), getStorageHealth(), getBatteryHealth()])
      setDevice(d)
      setStorage(s)
      setBattery(b)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (desktop) void loadStatic()
  }, [desktop, loadStatic])

  // Live memory pressure / CPU for the summary — a slow poll; this screen
  // doesn't need the Performance screen's pace.
  usePolling(
    async () => setSnapshot(await getPerformanceSnapshot()),
    desktop && monitoringEnabled ? 5000 : null,
  )
  // Battery level/charging changes slowly; refresh it occasionally.
  usePolling(async () => setBattery(await getBatteryHealth()), desktop ? 30_000 : null)

  const header = (
    <PageHeader
      title={t('health.title')}
      description={t('health.description')}
      actions={
        desktop ? (
          <Button variant="secondary" size="sm" onClick={() => void loadStatic()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            {t('common.refresh')}
          </Button>
        ) : undefined
      }
    />
  )

  if (!desktop) {
    return (
      <div>
        {header}
        <EmptyState icon={HeartPulse} title={t('common.desktopOnlyTitle')} description={t('common.desktopOnlyBody')} />
      </div>
    )
  }

  const unavailable = <span className="font-normal text-text-faint">{t('common.unavailable')}</span>
  const m = snapshot?.memory ?? null
  const cpuNow = snapshot?.cpu.usagePercent ?? null
  const freeRatio = storage && storage.totalBytes > 0 ? storage.availableBytes / storage.totalBytes : null
  const uptime = device?.uptimeSecs ?? snapshot?.system.uptimeSecs ?? null
  const conditionText = (c: string) => (c === 'Normal' ? t('health.battery.conditionNormal') : c)
  const batteryBad = battery?.present && battery.condition && battery.condition !== 'Normal'

  // Thresholds are deliberately simple and stated: storage <5% free (or
  // <5 GB) needs attention, <15% is fair; CPU is an instantaneous reading.
  const summary: SummaryItem[] = [
    {
      key: 'memory',
      label: t('health.summary.memory'),
      value: m?.pressure ? t(`perf.pressure.${m.pressure}`) : unavailable,
      tone: m?.pressure ? (m.pressure === 'normal' ? 'good' : m.pressure === 'elevated' ? 'fair' : 'attention') : null,
    },
    {
      key: 'cpu',
      label: t('health.summary.cpu'),
      value: cpuNow === null ? unavailable : fmt.percent(cpuNow),
      tone: cpuNow === null ? null : cpuNow >= 90 ? 'attention' : cpuNow >= 70 ? 'fair' : 'good',
    },
    {
      key: 'storage',
      label: t('health.summary.storage'),
      value: storage ? fmt.bytes(storage.availableBytes) : unavailable,
      tone:
        freeRatio === null || !storage
          ? null
          : freeRatio < 0.05 || storage.availableBytes < 5e9
            ? 'attention'
            : freeRatio < 0.15
              ? 'fair'
              : 'good',
    },
    {
      key: 'battery',
      label: t('health.summary.battery'),
      value: !battery ? unavailable : !battery.present ? t('health.battery.none') : battery.condition ? conditionText(battery.condition) : unavailable,
      tone: !battery?.present || !battery.condition ? null : batteryBad ? 'attention' : 'good',
    },
    {
      key: 'uptime',
      label: t('health.summary.uptime'),
      value: uptime === null ? unavailable : fmt.duration(uptime),
      // Uptime is informational only — a long uptime is not a problem.
      tone: null,
    },
  ]

  const recommendations: { text: string; action?: { label: string; to: string } }[] = []
  if (m?.pressure && m.pressure !== 'normal') {
    recommendations.push({ text: t('health.rec.memory', { level: t(`perf.pressure.${m.pressure}`) }), action: { label: t('health.rec.openPerformance'), to: '/performance' } })
  }
  if (cpuNow !== null && cpuNow >= 90) {
    recommendations.push({ text: t('health.rec.cpu', { percent: fmt.percent(cpuNow) }), action: { label: t('health.rec.openPerformance'), to: '/performance?tab=processes' } })
  }
  if (storage && summary[2].tone && summary[2].tone !== 'good') {
    recommendations.push({ text: t('health.rec.storage', { free: fmt.bytes(storage.availableBytes) }), action: { label: t('health.rec.openCleanup'), to: '/cleanup' } })
  }
  if (batteryBad && battery?.condition) {
    recommendations.push({ text: t('health.rec.battery', { condition: battery.condition }) })
  }
  // Long uptime is only mentioned as context, never as a problem on its own.
  if (uptime !== null && uptime >= 7 * 86400) {
    recommendations.push({ text: t('health.rec.uptime', { duration: fmt.duration(uptime) }) })
  }

  const usedPct = storage && storage.totalBytes > 0 ? (storage.usedBytes / storage.totalBytes) * 100 : 0
  const cores =
    device?.performanceCores != null && device.efficiencyCores != null && device.physicalCores != null
      ? t('health.device.coresSplit', { total: device.physicalCores, performance: device.performanceCores, efficiency: device.efficiencyCores })
      : device?.physicalCores != null && device.logicalCores != null
        ? t('perf.cpu.coresValue', { physical: device.physicalCores, logical: device.logicalCores })
        : null

  return (
    <div className="space-y-5 pb-10">
      {header}
      {error && <p className="rounded-lg bg-protected-soft p-2.5 text-[12px] text-text">{t('common.error', { error })}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse size={16} className="text-text-faint" />
            {t('health.summary.title')}
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {summary.map((item) => (
              <div key={item.key} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface-2/50 p-3">
                <span className="text-[12px] text-text-muted">{item.label}</span>
                <span className="truncate text-[15px] font-semibold text-text">{item.value}</span>
                <StatusChip tone={item.tone ?? 'neutral'} label={statusLabel(item.tone ?? 'neutral', t)} className="self-start" />
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-text">
              <Lightbulb size={14} className="text-text-faint" />
              {t('health.rec.title')}
            </p>
            {recommendations.length === 0 ? (
              <p className="text-[13px] text-text-muted">{t('health.rec.none')}</p>
            ) : (
              <ul className="space-y-2">
                {recommendations.map((r) => (
                  <li key={r.text} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-text">
                    <span className="min-w-0 flex-1">{r.text}</span>
                    {r.action && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(r.action!.to)}>
                        {r.action.label}
                        <ArrowRight size={13} className="rtl:rotate-180" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Laptop size={16} className="text-text-faint" />
              {t('health.device.title')}
            </CardTitle>
          </CardHeader>
          <CardBody className="divide-y divide-border pt-2">
            {!device ? (
              <p className="py-6 text-center text-[13px] text-text-faint">{t('common.loading')}</p>
            ) : (
              <>
                <InfoRow label={t('health.device.modelName')} value={device.modelName ?? unavailable} />
                <InfoRow label={t('health.device.modelIdentifier')} value={device.modelIdentifier ?? unavailable} />
                <InfoRow label={t('health.device.modelNumber')} value={device.modelNumber ?? unavailable} />
                <InfoRow
                  label={t('health.device.serial')}
                  hint={t('health.device.serialHint')}
                  value={device.serialAvailable ? <SerialNumber /> : unavailable}
                />
                <InfoRow
                  label={t('health.device.processor')}
                  value={device.processorKind === 'appleSilicon' ? t('health.device.appleSilicon') : device.processorKind === 'intel' ? t('health.device.intel') : unavailable}
                />
                <InfoRow label={t('health.device.chip')} value={device.chipName ?? unavailable} />
                <InfoRow label={t('health.device.cores')} value={cores ?? unavailable} />
                <InfoRow
                  label={t('health.device.gpu')}
                  value={
                    device.gpus.length === 0
                      ? unavailable
                      : device.gpus
                          .map((g) => (g.coreCount ? t('health.device.gpuCores', { model: g.model, count: g.coreCount }) : g.model))
                          .join(', ')
                  }
                />
                <InfoRow label={t('health.device.memory')} value={device.memoryBytes ? fmt.bytes(device.memoryBytes, 0) : unavailable} />
                <InfoRow
                  label={t('health.device.os')}
                  value={device.osVersion ? t('health.device.osValue', { version: device.osVersion, build: device.osBuild ?? '—' }) : unavailable}
                />
                <InfoRow
                  label={t('health.device.architecture')}
                  value={
                    device.architecture ? (
                      <span>
                        {device.architecture}
                        {device.runningUnderRosetta && <span className="block text-[11px] font-normal text-text-faint">{t('health.device.rosetta')}</span>}
                      </span>
                    ) : (
                      unavailable
                    )
                  }
                />
                <InfoRow label={t('health.device.uptime')} value={uptime === null ? unavailable : fmt.duration(uptime)} />
                <InfoRow label={t('health.device.lastBoot')} value={device.bootTimeMs ? fmt.dateTime(device.bootTimeMs) : unavailable} />
              </>
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive size={16} className="text-text-faint" />
                {t('health.storage.title')}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {!storage ? (
                <p className="py-6 text-center text-[13px] text-text-faint">{t('common.loading')}</p>
              ) : (
                <>
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-text">{storage.volumeName}</span>
                      <span className="text-[12px] text-text-muted">{t('health.storage.freeOf', { free: fmt.bytes(storage.availableBytes), total: fmt.bytes(storage.totalBytes, 0) })}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100} aria-label={t('health.storage.used')}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${usedPct}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap justify-between gap-2 text-[12px] text-text-muted">
                      <span>
                        {t('health.storage.used')}: <span className="font-medium text-text">{fmt.bytes(storage.usedBytes)} ({fmt.percent(usedPct)})</span>
                      </span>
                      {storage.purgeableBytes > 0 && <span>{t('health.storage.purgeable', { size: fmt.bytes(storage.purgeableBytes) })}</span>}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-[12px] font-semibold text-text-muted">{t('health.storage.volumes')}</p>
                    <ul className="divide-y divide-border">
                      {storage.volumes.map((v) => (
                        <li key={v.mountPoint} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-text">{v.name}</span>
                            <span className="block text-[11px] text-text-faint">
                              {[
                                v.isInternalStartup ? t('health.storage.startup') : t('health.storage.external'),
                                v.isRemovable ? t('health.storage.removable') : null,
                                `${t('health.storage.fileSystem')}: ${v.fileSystem.toUpperCase()}`,
                                v.kind === 'ssd' ? 'SSD' : v.kind === 'hdd' ? 'HDD' : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          <span className="shrink-0 text-[12px] tabular-nums text-text-muted">
                            {t('health.storage.freeOf', { free: fmt.bytes(v.availableBytes), total: fmt.bytes(v.totalBytes, 0) })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {storage.internalDisk && (
                    <InfoRow
                      className="border-t border-border"
                      label={t('health.storage.drive')}
                      value={[storage.internalDisk.model, storage.internalDisk.mediumType, storage.internalDisk.interconnect].filter(Boolean).join(' · ') || unavailable}
                    />
                  )}
                  <p className="text-[11px] text-text-faint">{t('health.storage.smartUnavailable')}</p>
                  <Button size="sm" variant="secondary" onClick={() => navigate('/cleanup')}>
                    {t('health.storage.openCleanup')}
                    <ArrowRight size={13} className="rtl:rotate-180" />
                  </Button>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {batteryBad ? <BatteryWarning size={16} className="text-protected" /> : <BatteryMedium size={16} className="text-text-faint" />}
                {t('health.battery.title')}
              </CardTitle>
              {battery?.present && battery.condition && (
                <StatusChip tone={batteryBad ? 'attention' : 'good'} label={conditionText(battery.condition)} />
              )}
            </CardHeader>
            <CardBody className="divide-y divide-border pt-2">
              {!battery ? (
                <p className="py-6 text-center text-[13px] text-text-faint">{t('common.loading')}</p>
              ) : !battery.present ? (
                <div className="py-4">
                  <p className="text-[13px] font-medium text-text">{t('health.battery.none')}</p>
                  <p className="text-[12px] text-text-muted">{t('health.battery.noneBody')}</p>
                </div>
              ) : (
                <>
                  <InfoRow label={t('health.battery.charge')} value={battery.percent === null ? unavailable : fmt.percent(battery.percent)} />
                  <InfoRow
                    label={t('health.battery.state')}
                    value={
                      battery.isCharging
                        ? t('health.battery.charging')
                        : battery.fullyCharged
                          ? t('health.battery.charged')
                          : battery.externalConnected
                            ? t('health.battery.notCharging')
                            : battery.isCharging === false
                              ? t('health.battery.discharging')
                              : unavailable
                    }
                  />
                  <InfoRow
                    label={t('health.battery.source')}
                    value={
                      battery.powerSource === 'AC Power'
                        ? t('health.battery.adapter')
                        : battery.powerSource === 'Battery Power'
                          ? t('health.battery.batteryPower')
                          : battery.powerSource ?? unavailable
                    }
                  />
                  <InfoRow label={t('health.battery.cycles')} value={battery.cycleCount === null ? unavailable : fmt.number(battery.cycleCount)} />
                  <InfoRow label={t('health.battery.condition')} value={battery.condition ? conditionText(battery.condition) : unavailable} />
                  <InfoRow
                    label={t('health.battery.maxCapacity')}
                    hint={t('health.battery.maxCapacityHint')}
                    value={battery.maximumCapacityPercent === null ? unavailable : fmt.percent(battery.maximumCapacityPercent, 0)}
                  />
                  <InfoRow
                    label={t('health.battery.fullCapacity')}
                    value={battery.fullChargeCapacityMah === null ? unavailable : t('health.battery.mah', { value: fmt.number(battery.fullChargeCapacityMah) })}
                  />
                  <InfoRow
                    label={t('health.battery.designCapacity')}
                    value={battery.designCapacityMah === null ? unavailable : t('health.battery.mah', { value: fmt.number(battery.designCapacityMah) })}
                  />
                  <InfoRow label={t('health.battery.temperature')} value={battery.temperatureC === null ? unavailable : fmt.celsius(battery.temperatureC)} />
                  {battery.isCharging && battery.timeToFullMin ? (
                    <InfoRow label={t('health.battery.timeToFull')} value={fmt.duration(battery.timeToFullMin * 60)} />
                  ) : !battery.externalConnected && battery.timeToEmptyMin ? (
                    <InfoRow label={t('health.battery.timeRemaining')} value={fmt.duration(battery.timeToEmptyMin * 60)} />
                  ) : null}
                  <InfoRow
                    label={t('health.battery.lowPower')}
                    value={battery.lowPowerMode === null ? unavailable : battery.lowPowerMode ? t('common.on') : t('common.off')}
                  />
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
