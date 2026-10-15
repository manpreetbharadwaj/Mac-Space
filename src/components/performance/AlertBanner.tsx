import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { RawActiveAlert } from '@/services/tauri/systemTypes'
import { useI18n, type MessageKey } from '@/i18n'
import { Button } from '@/components/ui/Button'

function alertText(alert: RawActiveAlert, t: ReturnType<typeof useI18n>['t'], fmt: ReturnType<typeof useI18n>['fmt']): string {
  const level = alert.level === 'critical' ? t('notify.levelCritical') : t('notify.levelElevated')
  switch (alert.kind) {
    case 'memoryPressure':
      return t('perf.alert.memoryPressure', { level })
    case 'swap':
      return t('perf.alert.swap')
    case 'appMemory':
      return t('perf.alert.appMemory', { app: alert.appName ?? '', size: fmt.bytes(alert.bytes ?? 0) })
    case 'cpu':
      return t('perf.alert.cpu', { percent: fmt.percent(alert.percent ?? 0) })
    case 'appCpu':
      return t('perf.alert.appCpu', { app: alert.appName ?? '', percent: fmt.percent(alert.percent ?? 0) })
    case 'storage':
      return t('perf.alert.storage', { size: fmt.bytes(alert.bytes ?? 0) })
    case 'battery':
      return t('perf.alert.battery', { condition: alert.condition ?? '' })
  }
}

const SUGGESTIONS: Record<RawActiveAlert['kind'], MessageKey[]> = {
  memoryPressure: ['perf.suggest.closeWindows', 'perf.suggest.quitBackground', 'perf.suggest.browserTabs', 'perf.suggest.restartMac'],
  swap: ['perf.suggest.quitBackground', 'perf.suggest.browserTabs', 'perf.suggest.restartMac'],
  appMemory: ['perf.suggest.closeWindows', 'perf.suggest.browserTabs', 'perf.suggest.restartApp'],
  cpu: ['perf.suggest.cpuCheck', 'perf.suggest.quitBackground'],
  appCpu: ['perf.suggest.cpuCheck', 'perf.suggest.restartApp'],
  storage: ['perf.suggest.freeStorage'],
  battery: [],
}

/**
 * Currently sustained conditions, as detected natively (see
 * evaluate_alerts in performance.rs). Only informs: every action here
 * navigates somewhere for the user to decide — nothing is ended for them.
 */
export function AlertBanner({
  alerts,
  onReviewApps,
  notificationUnavailable,
}: {
  alerts: RawActiveAlert[]
  onReviewApps: () => void
  notificationUnavailable: boolean
}) {
  const { t, fmt } = useI18n()
  const navigate = useNavigate()
  if (alerts.length === 0) return null
  const suggestions = Array.from(new Set(alerts.flatMap((a) => SUGGESTIONS[a.kind])))
  const hasStorage = alerts.some((a) => a.kind === 'storage')
  const hasProcessAlert = alerts.some((a) => a.kind !== 'storage' && a.kind !== 'battery')

  return (
    <div role="status" className="rounded-2xl border border-review/30 bg-review-soft p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-review" />
        <div className="min-w-0 flex-1 space-y-3">
          <ul className="space-y-1">
            {alerts.map((a, i) => (
              <li key={`${a.kind}-${a.pid ?? i}`} className="text-[13px] font-medium text-text">
                {alertText(a, t, fmt)}{' '}
                <span className="font-normal text-text-muted">· {t('perf.alert.since', { time: fmt.time(a.sinceMs) })}</span>
              </li>
            ))}
          </ul>
          {suggestions.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-text-muted">{t('perf.alert.whatMayHelp')}</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[12px] text-text-muted">
                {suggestions.map((s) => (
                  <li key={s}>{t(s)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {hasProcessAlert && (
              <Button size="sm" variant="secondary" onClick={onReviewApps}>
                {t('perf.alert.reviewApps')}
                <ArrowRight size={13} className="rtl:rotate-180" />
              </Button>
            )}
            {hasStorage && (
              <Button size="sm" variant="secondary" onClick={() => navigate('/cleanup')}>
                {t('perf.alert.openCleanup')}
                <ArrowRight size={13} className="rtl:rotate-180" />
              </Button>
            )}
          </div>
          {notificationUnavailable && <p className="text-[11px] text-text-faint">{t('perf.alert.notificationUnavailable')}</p>}
        </div>
      </div>
    </div>
  )
}
