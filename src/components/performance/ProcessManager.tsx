import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, RefreshCw, Lock, Info, Power, Zap, Cpu as CpuIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Segmented } from '@/components/ui/Segmented'
import { PremiumSwitch } from '@/components/ui/PremiumSwitch'
import { InfoRow } from '@/components/ui/InfoRow'
import { useAppStore } from '@/store/useAppStore'
import { usePolling } from '@/hooks/usePolling'
import { useI18n, type MessageKey } from '@/i18n'
import { getAppIcons, getProcessDetails, getRunningProcesses, terminateProcess } from '@/services/tauri/bridge'
import type { RawProcess, RawProcessDetails, RawProcessList, TerminateOutcome } from '@/services/tauri/systemTypes'

type Filter = 'apps' | 'background' | 'all'
type Sort = 'memory' | 'cpu'

/** Rendering every one of ~600 processes every refresh is wasted work; search reaches the rest. */
const MAX_ROWS = 150

function memoryOf(p: RawProcess) {
  return p.kind === 'app' ? p.groupMemoryBytes : p.memoryBytes
}
function cpuOf(p: RawProcess) {
  return p.kind === 'app' ? p.groupCpuPercent : p.cpuPercent
}

const STATUS_KEY: Record<string, MessageKey> = {
  running: 'proc.status.running',
  sleeping: 'proc.status.sleeping',
  idle: 'proc.status.idle',
  stopped: 'proc.status.stopped',
  zombie: 'proc.status.zombie',
}
const TYPE_KEY: Record<RawProcess['kind'], MessageKey> = {
  app: 'proc.type.app',
  background: 'proc.type.background',
  system: 'proc.type.system',
}
const RESULT_KEY: Record<TerminateOutcome, MessageKey> = {
  exited: 'proc.result.exited',
  stillRunning: 'proc.result.stillRunning',
  refused: 'proc.result.refused',
  notFound: 'proc.result.notFound',
  identityMismatch: 'proc.result.identityMismatch',
  protected: 'proc.result.protected',
  permissionDenied: 'proc.result.permissionDenied',
  failed: 'proc.result.failed',
}

function ProcessIcon({ src, kind }: { src?: string; kind: RawProcess['kind'] }) {
  if (src) return <img src={src} alt="" className="h-6 w-6 shrink-0" draggable={false} />
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-faint">
      {kind === 'system' ? <Lock size={12} /> : <CpuIcon size={12} />}
    </span>
  )
}

export function ProcessManager({ refreshIntervalMs }: { refreshIntervalMs: number }) {
  const { t, fmt } = useI18n()
  const pushToast = useAppStore((s) => s.pushToast)
  const [list, setList] = useState<RawProcessList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('apps')
  const [sort, setSort] = useState<Sort>('memory')
  const [query, setQuery] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [icons, setIcons] = useState<Record<number, string>>({})
  const requestedIcons = useRef(new Set<number>())
  const [busyPid, setBusyPid] = useState<number | null>(null)
  const [confirmForce, setConfirmForce] = useState<RawProcess | null>(null)
  const [detailsFor, setDetailsFor] = useState<RawProcess | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await getRunningProcesses()
      setList(next)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  usePolling(refresh, autoRefresh ? refreshIntervalMs : null)

  // Real app icons, fetched once per newly seen app (cached natively by bundle).
  useEffect(() => {
    if (!list) return
    const missing = list.processes.filter((p) => p.kind === 'app' && !requestedIcons.current.has(p.pid)).map((p) => p.pid)
    if (missing.length === 0) return
    missing.forEach((pid) => requestedIcons.current.add(pid))
    void getAppIcons(missing)
      .then((found) => setIcons((prev) => ({ ...prev, ...found })))
      .catch(() => {})
  }, [list])

  const rows = useMemo(() => {
    if (!list) return []
    const q = query.trim().toLocaleLowerCase()
    const filtered = list.processes.filter((p) => {
      if (q) {
        return p.name.toLocaleLowerCase().includes(q) || String(p.pid) === q || (p.bundleId ?? '').toLocaleLowerCase().includes(q)
      }
      if (filter === 'apps') return p.kind === 'app'
      // Helpers are already counted inside their app's group totals.
      if (filter === 'background') return p.kind === 'background' && !p.isAppHelper
      return true
    })
    const key = sort === 'memory' ? memoryOf : cpuOf
    // Unknown (null) values sort last instead of being treated as zero.
    return filtered.sort((a, b) => (key(b) ?? -1) - (key(a) ?? -1) || a.name.localeCompare(b.name))
  }, [list, filter, sort, query])

  const shown = rows.slice(0, MAX_ROWS)

  const runTerminate = async (p: RawProcess, force: boolean) => {
    setBusyPid(p.pid)
    if (!force) pushToast(t('proc.quitting', { app: p.name }), 'default')
    try {
      const result = await terminateProcess(p.pid, p.startTime, force)
      const tone = result.outcome === 'exited' ? 'success' : 'warning'
      pushToast(t(RESULT_KEY[result.outcome], { app: p.name, error: result.message ?? '' }), tone)
    } catch (e) {
      pushToast(t('proc.result.failed', { app: p.name, error: String(e) }), 'warning')
    } finally {
      setBusyPid(null)
      void refresh()
    }
  }

  const counts = list
    ? {
        apps: list.appCount,
        background: list.processes.filter((p) => p.kind === 'background' && !p.isAppHelper).length,
        all: list.totalCount,
      }
    : undefined

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="relative min-w-[180px] flex-1">
          <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('proc.search')}
            aria-label={t('proc.search')}
            className="h-8 w-full rounded-lg border border-border bg-surface ps-8 pe-3 text-[12px] text-text placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          />
        </div>
        <Segmented
          size="sm"
          label={t('proc.filter.all')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'apps', label: t('proc.filter.apps'), count: counts?.apps },
            { value: 'background', label: t('proc.filter.background'), count: counts?.background },
            { value: 'all', label: t('proc.filter.all'), count: counts?.all },
          ]}
        />
        <Segmented
          size="sm"
          label={t('proc.sort.label')}
          value={sort}
          onChange={setSort}
          options={[
            { value: 'memory', label: t('proc.sort.memory') },
            { value: 'cpu', label: t('proc.sort.cpu') },
          ]}
        />
        <div className="flex items-center gap-2 ps-1">
          <span className="text-[12px] text-text-muted">{t('proc.autoRefresh')}</span>
          <PremiumSwitch checked={autoRefresh} onChange={setAutoRefresh} label={t('proc.autoRefresh')} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} aria-label={t('common.refresh')} title={t('common.refresh')}>
          <RefreshCw size={14} />
        </Button>
      </div>

      {error && <p className="bg-protected-soft px-4 py-2 text-[12px] text-text">{t('common.error', { error })}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-text-faint">
              <th className="px-4 py-2 text-start">{t('proc.col.name')}</th>
              <th className="px-3 py-2 text-end">{t('proc.col.pid')}</th>
              <th className="px-3 py-2 text-end" title={t('proc.memoryHint')}>
                {t('proc.col.memory')}
              </th>
              <th className="px-3 py-2 text-end" title={t('proc.cpuHint')}>
                {t('proc.col.cpu')}
              </th>
              <th className="px-3 py-2 text-start">{t('proc.col.type')}</th>
              <th className="px-3 py-2 text-start">{t('proc.col.status')}</th>
              <th className="px-4 py-2 text-end">{t('proc.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {!list && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-faint">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {list && shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-faint">
                  {t('proc.empty')}
                </td>
              </tr>
            )}
            {shown.map((p) => {
              const mem = memoryOf(p)
              const cpu = cpuOf(p)
              const busy = busyPid === p.pid
              const status = p.isActive ? t('proc.status.active') : p.isHidden ? t('proc.status.hidden') : p.status && STATUS_KEY[p.status] ? t(STATUS_KEY[p.status]) : '—'
              return (
                <tr key={`${p.pid}-${p.startTime}`} className="border-b border-border/70 last:border-0 hover:bg-surface-hover/50">
                  <td className="max-w-[280px] px-4 py-2">
                    <button type="button" onClick={() => setDetailsFor(p)} className="flex min-w-0 items-center gap-2.5 text-start">
                      <ProcessIcon src={icons[p.pid]} kind={p.kind} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text">{p.name}</span>
                        {p.kind === 'app' && p.helperCount > 0 && (
                          <span className="block truncate text-[11px] text-text-faint">{t('proc.helpers', { count: p.helperCount })}</span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums text-text-muted">{p.pid}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-text">
                    {mem === null ? (
                      <span className="text-text-faint" title={t('proc.restrictedHint')}>
                        {t('proc.restricted')}
                      </span>
                    ) : (
                      fmt.bytes(mem)
                    )}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums text-text">
                    {cpu === null ? (
                      <span className="text-text-faint" title={mem === null ? t('proc.restrictedHint') : undefined}>
                        {mem === null ? t('proc.restricted') : t('proc.measuring')}
                      </span>
                    ) : (
                      fmt.percent(cpu, 1)
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{t(TYPE_KEY[p.kind])}</td>
                  <td className="px-3 py-2 text-text-muted">{status}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {p.protection ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-faint"
                          title={t(`proc.protection.${p.protection}` as MessageKey)}
                        >
                          <Lock size={11} />
                          {t('proc.protected')}
                        </span>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runTerminate(p, false)} title={t('proc.quit')}>
                            <Power size={13} />
                            <span className="hidden xl:inline">{t('proc.quit')}</span>
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmForce(p)} title={t('proc.forceQuit')} className="text-protected hover:text-protected">
                            <Zap size={13} />
                            <span className="hidden xl:inline">{t('proc.forceQuit')}</span>
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setDetailsFor(p)} aria-label={t('proc.details')} title={t('proc.details')}>
                        <Info size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && (
        <p className="border-t border-border px-4 py-2 text-[12px] text-text-faint">{t('proc.showingTop', { shown: MAX_ROWS, total: rows.length })}</p>
      )}

      <Modal
        open={confirmForce !== null}
        onClose={() => setConfirmForce(null)}
        title={confirmForce ? t('proc.forceQuitTitle', { app: confirmForce.name }) : ''}
        width="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmForce(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const target = confirmForce
                setConfirmForce(null)
                if (target) void runTerminate(target, true)
              }}
            >
              {t('proc.forceQuitConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-text-muted">{t('proc.forceQuitBody')}</p>
      </Modal>

      <ProcessDetailsModal
        process={detailsFor}
        icon={detailsFor ? icons[detailsFor.pid] : undefined}
        onClose={() => setDetailsFor(null)}
        onQuit={(p) => {
          setDetailsFor(null)
          void runTerminate(p, false)
        }}
        onForceQuit={(p) => {
          setDetailsFor(null)
          setConfirmForce(p)
        }}
      />
    </Card>
  )
}

function ProcessDetailsModal({
  process,
  icon,
  onClose,
  onQuit,
  onForceQuit,
}: {
  process: RawProcess | null
  icon?: string
  onClose: () => void
  onQuit: (p: RawProcess) => void
  onForceQuit: (p: RawProcess) => void
}) {
  const { t, fmt } = useI18n()
  const [details, setDetails] = useState<RawProcessDetails | null | undefined>(undefined)

  useEffect(() => {
    if (!process) return
    let cancelled = false
    setDetails(undefined)
    void getProcessDetails(process.pid)
      .then((d) => {
        // A different process now holds this PID — don't show its details as this one's.
        if (!cancelled) setDetails(d && d.startTime === process.startTime ? d : null)
      })
      .catch(() => !cancelled && setDetails(null))
    return () => {
      cancelled = true
    }
  }, [process])

  const unavailable = <span className="font-normal text-text-faint">{t('common.unavailable')}</span>
  const bytes = (v: number | null | undefined) => (v === null || v === undefined ? unavailable : fmt.bytes(v))

  return (
    <Modal
      open={process !== null}
      onClose={onClose}
      title={t('proc.detail.title')}
      footer={
        process && !process.protection && details ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => onQuit(process)}>
              <Power size={13} />
              {t('proc.quit')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => onForceQuit(process)}>
              <Zap size={13} />
              {t('proc.forceQuit')}
            </Button>
          </>
        ) : undefined
      }
    >
      {process && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <ProcessIcon src={icon} kind={process.kind} />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-text">{process.name}</p>
              {process.protection && (
                <p className="flex items-center gap-1.5 text-[12px] text-text-muted">
                  <Lock size={11} />
                  {t(`proc.protection.${process.protection}` as MessageKey)}
                </p>
              )}
            </div>
          </div>
          {details === undefined && <p className="text-[13px] text-text-faint">{t('common.loading')}</p>}
          {details === null && <p className="text-[13px] text-text-muted">{t('proc.detail.gone')}</p>}
          {details && (
            <div className="divide-y divide-border">
              <InfoRow label={t('proc.detail.pid')} value={details.pid} />
              <InfoRow
                label={t('proc.detail.parent')}
                value={details.parentPid !== null ? `${details.parentName ?? '—'} (${details.parentPid})` : unavailable}
              />
              <InfoRow label={t('proc.detail.type')} value={t(TYPE_KEY[details.kind])} />
              <InfoRow label={t('proc.detail.status')} value={details.status && STATUS_KEY[details.status] ? t(STATUS_KEY[details.status]) : unavailable} />
              <InfoRow label={t('proc.detail.bundleId')} value={details.bundleId ?? unavailable} />
              <InfoRow label={t('proc.detail.path')} value={details.path ? <span className="font-mono text-[11px]">{details.path}</span> : unavailable} />
              <InfoRow label={t('proc.detail.user')} value={details.user ?? unavailable} />
              <InfoRow label={t('proc.detail.started')} value={fmt.dateTime(details.startTime * 1000)} />
              <InfoRow label={t('proc.detail.runTime')} value={fmt.duration(details.runTimeSecs)} />
              <InfoRow label={t('proc.detail.memory')} value={bytes(details.memoryBytes)} hint={t('proc.memoryHint')} />
              <InfoRow label={t('proc.detail.resident')} value={bytes(details.residentBytes)} />
              <InfoRow label={t('proc.detail.virtual')} value={bytes(details.virtualBytes)} />
              <InfoRow
                label={t('proc.detail.cpuTime')}
                value={
                  details.cpuTimeSecs === null
                    ? unavailable
                    : details.cpuTimeSecs < 60
                      ? fmt.seconds(details.cpuTimeSecs)
                      : fmt.duration(details.cpuTimeSecs)
                }
              />
              <InfoRow label={t('proc.detail.diskRead')} value={bytes(details.diskReadTotalBytes)} />
              <InfoRow label={t('proc.detail.diskWritten')} value={bytes(details.diskWrittenTotalBytes)} />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
