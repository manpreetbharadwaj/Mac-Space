import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, Mail, ShieldCheck, History as HistoryIcon, Radio } from 'lucide-react'
import { clsx } from 'clsx'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PremiumSwitch } from '@/components/ui/PremiumSwitch'
import { SystemSettingsAction } from '@/components/ui/SystemSettingsAction'
import { Modal } from '@/components/ui/Modal'
import { useAppStore } from '@/store/useAppStore'
import { useI18n } from '@/i18n'
import { DASHBOARD_CATEGORY_ORDER } from '@/mocks'
import type { ScheduleFrequency, ScheduleMode, ScheduleRule, StorageCategoryId } from '@/types'

const FREQUENCIES: ScheduleFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly']

/**
 * Must match src-tauri/src/auto_clean.rs's `POLICY_VERSION`. The background
 * job independently refuses to auto-clean unless the persisted
 * `schedule.autoCleanConsentVersion` is >= its own compiled-in constant —
 * this UI-side copy only decides when to show the consent modal again, it
 * is not itself trusted as authorization (see background.rs).
 */
const AUTO_CLEAN_POLICY_VERSION = 1

export function Schedule() {
  const schedule = useAppStore((s) => s.schedule)
  const scheduleInstalled = useAppStore((s) => s.scheduleInstalled)
  const scanEvents = useAppStore((s) => s.scanEvents)
  const settings = useAppStore((s) => s.settings)
  const notificationPermission = useAppStore((s) => s.notificationPermission)
  const saveSchedule = useAppStore((s) => s.saveSchedule)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const requestNotificationPermission = useAppStore((s) => s.requestNotificationPermission)
  const openNotificationSettings = useAppStore((s) => s.openNotificationSettings)
  const [draft, setDraft] = useState<ScheduleRule | null>(schedule)
  const [dirty, setDirty] = useState(false)
  const [showAutoCleanConsent, setShowAutoCleanConsent] = useState(false)
  const { t, fmt } = useI18n()

  useEffect(() => {
    if (schedule && !dirty) setDraft(schedule)
  }, [schedule, dirty])

  if (!draft || !settings) return null
  const current = draft

  const update = (patch: Partial<ScheduleRule>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
    setDirty(true)
  }

  // Reminder mode never needs confirmation. Auto-clean needs it once per
  // policy version — re-selecting it after already consenting at the
  // current version (e.g. after toggling to Reminder and back) does not
  // show the modal again.
  const selectMode = (mode: ScheduleMode) => {
    if (mode === 'auto-clean' && current.autoCleanConsentVersion < AUTO_CLEAN_POLICY_VERSION) {
      setShowAutoCleanConsent(true)
      return
    }
    update({ mode })
  }

  const confirmAutoCleanConsent = () => {
    update({ mode: 'auto-clean', autoCleanConsentVersion: AUTO_CLEAN_POLICY_VERSION })
    setShowAutoCleanConsent(false)
  }

  const toggleCategory = (id: StorageCategoryId) => {
    const has = current.safeCategories.includes(id)
    update({
      safeCategories: has ? current.safeCategories.filter((c) => c !== id) : [...current.safeCategories, id],
    })
  }

  const handleSave = async () => {
    await saveSchedule(current)
    setDirty(false)
  }

  return (
    <div className="max-w-2xl space-y-5 pb-16">
      <PageHeader
        title={t('sched.title')}
        description={t('sched.description')}
      />

      <Card>
        <CardBody className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-text">{t('sched.scans')}</p>
            <p className="text-[12px] text-text-muted">{t('sched.scansHint')}</p>
          </div>
          <PremiumSwitch checked={draft.enabled} onChange={(v) => update({ enabled: v })} label={t('sched.scans')} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sched.frequencyTitle')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                onClick={() => update({ frequency: f })}
                className={clsx(
                  'rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors',
                  draft.frequency === f
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-text-muted hover:text-text',
                )}
              >
                {t(`sched.freq.${f}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-[13px] text-text-muted">{t('sched.runAt')}</p>
            <input
              type="time"
              value={draft.timeOfDay}
              onChange={(e) => update({ timeOfDay: e.target.value })}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text"
            />
          </div>
          {draft.frequency === 'biweekly' && (
            <p className="text-[11px] text-text-faint">
              {t('sched.biweeklyNote')}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sched.mode')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {(
            [
              { key: 'reminder' as ScheduleMode, label: t('sched.reminder'), desc: t('sched.reminderDesc') },
              { key: 'auto-clean' as ScheduleMode, label: t('sched.autoClean'), desc: t('sched.autoCleanDesc') },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => selectMode(opt.key)}
              className={clsx(
                'flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-colors',
                draft.mode === opt.key ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
              )}
            >
              <div
                className={clsx(
                  'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                  draft.mode === opt.key ? 'border-accent bg-accent' : 'border-border-strong',
                )}
              />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-text">{opt.label}</p>
                <p className="text-[12px] text-text-muted">{opt.desc}</p>
              </div>
            </button>
          ))}

          {current.mode === 'auto-clean' && (
            <div className="rounded-xl border border-safe/40 bg-safe-soft/40 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-text">
                <ShieldCheck size={13} className="text-safe" />
                {t('sched.allowlistTitle')}
              </p>
              <p className="text-[11px] text-text-faint">{t('sched.allowlistBody')}</p>
            </div>
          )}

          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text">
              <ShieldCheck size={13} className="text-text-faint" />
              {t('sched.categoriesTitle')}
            </p>
            <div className="flex flex-wrap gap-2">
              {DASHBOARD_CATEGORY_ORDER.map((id) => (
                <button
                  key={id}
                  onClick={() => toggleCategory(id)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                    current.safeCategories.includes(id)
                      ? 'border-safe bg-safe-soft text-safe'
                      : 'border-border text-text-muted hover:text-text',
                  )}
                >
                  {t(`cat.${id}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-text-faint">
              {t('sched.categoriesNote')}
            </p>
          </div>
        </CardBody>
      </Card>

      <Modal
        open={showAutoCleanConsent}
        onClose={() => setShowAutoCleanConsent(false)}
        title={t('sched.consentTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAutoCleanConsent(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={confirmAutoCleanConsent}>
              {t('sched.consentEnable')}
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-[13px] text-text">
          {(['sched.consent1', 'sched.consent2', 'sched.consent3', 'sched.consent4', 'sched.consent5', 'sched.consent6'] as const).map((k) => (
            <li key={k}>• {t(k)}</li>
          ))}
        </ul>
      </Modal>

      <Card>
        <CardHeader>
          <CardTitle>{t('sched.notifTitle')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium text-text">{t('sched.enable')}</p>
              <p className="text-[12px] text-text-muted">{t('sched.enableHint')}</p>
            </div>
            <PremiumSwitch
              checked={settings.notificationsEnabled}
              onChange={(v) => saveSettings({ ...settings, notificationsEnabled: v })}
              label={t('sched.enable')}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-2 p-3">
            <p className="flex items-center gap-1.5 text-[12px] text-text-muted">
              {notificationPermission === 'granted' ? (
                <BellRing size={14} className="text-safe" />
              ) : notificationPermission === 'denied' ? (
                <BellOff size={14} className="text-protected" />
              ) : (
                <Bell size={14} className="text-text-faint" />
              )}
              {t('sched.permission')}{' '}
              <span className="font-medium text-text">
                {notificationPermission === 'granted'
                  ? t('sched.granted')
                  : notificationPermission === 'denied'
                    ? t('sched.denied')
                    : t('sched.notRequested')}
              </span>
            </p>
            <div className="flex shrink-0 gap-2">
              {notificationPermission !== 'granted' && (
                <Button size="sm" variant="secondary" onClick={requestNotificationPermission}>
                  {t('sched.enableBtn')}
                </Button>
              )}
              <SystemSettingsAction label={t('settings.openNotificationSettings')} onClick={openNotificationSettings} />
            </div>
          </div>
          <p className="text-[11px] text-text-faint">
            {t('sched.notifNote')}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sched.thresholdsTitle')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <Bell size={13} /> {t('sched.freeBelow')}
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={draft.thresholdFreeGb}
                onChange={(e) => update({ thresholdFreeGb: Number(e.target.value) })}
                className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-end text-[13px] text-text"
              />
              <span className="text-[12px] text-text-muted">{t('sched.gb')}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <Bell size={13} /> {t('sched.reclaimAbove')}
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={draft.thresholdReclaimableGb}
                onChange={(e) => update({ thresholdReclaimableGb: Number(e.target.value) })}
                className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-end text-[13px] text-text"
              />
              <span className="text-[12px] text-text-muted">{t('sched.gb')}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-3 opacity-60">
            <p className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <Mail size={13} /> {t('sched.email')}
            </p>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-text-faint">{t('sched.comingLater')}</span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 text-[12px] text-text-muted">
          <div className="flex items-center justify-between">
            <span>{t('sched.lastRun')}</span>
            <span className="font-medium text-text">{draft.lastRunAt ? fmt.dateTimeIso(draft.lastRunAt) : t('sched.never')}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('sched.nextRun')}</span>
            <span className="font-medium text-text">
              {draft.enabled && draft.nextRunAt ? fmt.dateTimeIso(draft.nextRunAt) : t('sched.notScheduled')}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="flex items-center gap-1.5">
              <Radio size={12} /> {t('sched.scheduler')}
            </span>
            <span
              className={clsx(
                'font-medium',
                !draft.enabled ? 'text-text-faint' : scheduleInstalled ? 'text-safe' : 'text-protected',
              )}
            >
              {!draft.enabled ? t('sched.off') : scheduleInstalled ? t('sched.active') : t('sched.notInstalled')}
            </span>
          </div>
        </CardBody>
      </Card>

      {scanEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('sched.recent')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {scanEvents.slice(0, 5).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <HistoryIcon size={13} className="shrink-0 text-text-faint" />
                  <div>
                    <p className="text-[12px] font-medium text-text">
                      {event.source === 'scheduled' ? t('sched.scheduledScan') : t('sched.manualScan')}
                    </p>
                    <p className="text-[11px] text-text-faint">{t('sched.scanOnly', { time: fmt.dateTimeIso(event.occurredAt) })}</p>
                  </div>
                </div>
                <div className="text-end">
                  <p className="text-[12px] font-medium text-text">{t('sched.reclaimable', { size: fmt.bytes(event.reclaimableBytes) })}</p>
                  {event.notificationSent && <p className="text-[11px] text-safe">{t('sched.notificationSent')}</p>}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={!dirty}
          onClick={() => {
            setDraft(schedule)
            setDirty(false)
          }}
        >
          {t('sched.discard')}
        </Button>
        <Button variant="primary" disabled={!dirty} onClick={handleSave}>
          {t('sched.save')}
        </Button>
      </div>
    </div>
  )
}
