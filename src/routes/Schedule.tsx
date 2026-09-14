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
import { formatBytes, formatDateTime } from '@/lib/format'
import { CATEGORY_LABELS, DASHBOARD_CATEGORY_ORDER } from '@/mocks'
import type { ScheduleFrequency, ScheduleMode, ScheduleRule, StorageCategoryId } from '@/types'

const FREQUENCIES: { key: ScheduleFrequency; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Biweekly' },
  { key: 'monthly', label: 'Monthly' },
]

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
        title="Schedule & Reminders"
        description="No surprise automation — scheduled cleanups always state exactly what categories are allowed."
      />

      <Card>
        <CardBody className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-text">Scheduled scans</p>
            <p className="text-[12px] text-text-muted">
              Turn on automatic scanning on a recurring cadence — runs in the background via a macOS LaunchAgent, even
              if the app window is closed.
            </p>
          </div>
          <PremiumSwitch checked={draft.enabled} onChange={(v) => update({ enabled: v })} label="Scheduled scans" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Frequency & time</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f.key}
                onClick={() => update({ frequency: f.key })}
                className={clsx(
                  'rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors',
                  draft.frequency === f.key
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-text-muted hover:text-text',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-[13px] text-text-muted">Run at</p>
            <input
              type="time"
              value={draft.timeOfDay}
              onChange={(e) => update({ timeOfDay: e.target.value })}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text"
            />
          </div>
          {draft.frequency === 'biweekly' && (
            <p className="text-[11px] text-text-faint">
              Biweekly runs on the same weekday as weekly, but skip every other occurrence.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mode</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {(
            [
              { key: 'reminder' as ScheduleMode, label: 'Reminder only', desc: 'Scans your Mac and lets you know when storage needs attention.' },
              {
                key: 'auto-clean' as ScheduleMode,
                label: 'Auto-clean Safe items',
                desc: 'Automatically moves only strictly approved cache and build data to Trash. Personal files and review items are never removed automatically.',
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => selectMode(opt.key)}
              className={clsx(
                'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
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
                Strict auto-clean allowlist — verified natively, not just labeled "safe"
              </p>
              <p className="text-[11px] text-text-faint">
                Only independently-verified, regenerable developer caches are ever eligible: Xcode DerivedData, npm,
                Yarn, pnpm, Gradle, and CocoaPods caches. Downloads, Documents, Desktop files, browser data, large or
                old files, duplicates, and anything else — including items merely labeled "Safe" elsewhere in this
                app — are never auto-cleaned. Exclusions are always respected, files go to Trash (never permanently
                deleted), and a summary notification is sent after each run.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text">
              <ShieldCheck size={13} className="text-text-faint" />
              Categories considered for the reclaimable-space notification
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
                  {CATEGORY_LABELS[id]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-text-faint">
              This only affects the "you might want to review storage" estimate — it is not the auto-clean allowlist
              above, and does not change what auto-clean is allowed to touch.
            </p>
          </div>
        </CardBody>
      </Card>

      <Modal
        open={showAutoCleanConsent}
        onClose={() => setShowAutoCleanConsent(false)}
        title="Turn on Auto-clean Safe items?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAutoCleanConsent(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmAutoCleanConsent}>
              Enable Auto-clean
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-[13px] text-text">
          <li>• Only strict, independently-verified cache and build data is eligible — see the allowlist above.</li>
          <li>• Files are moved to the macOS Trash, never permanently deleted.</li>
          <li>• Personal files (Documents, Desktop, Downloads, media, browser data) are never auto-cleaned.</li>
          <li>• Your exclusions are always respected.</li>
          <li>• Anything marked Review or Protected is never auto-cleaned.</li>
          <li>• A summary notification is sent after each run that actually cleans something.</li>
        </ul>
      </Modal>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium text-text">Enable notifications</p>
              <p className="text-[12px] text-text-muted">Required for scheduled scans to alert you at all.</p>
            </div>
            <PremiumSwitch
              checked={settings.notificationsEnabled}
              onChange={(v) => saveSettings({ ...settings, notificationsEnabled: v })}
              label="Enable notifications"
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
              macOS permission:{' '}
              <span className="font-medium text-text">
                {notificationPermission === 'granted'
                  ? 'Granted'
                  : notificationPermission === 'denied'
                    ? 'Denied'
                    : 'Not yet requested'}
              </span>
            </p>
            <div className="flex shrink-0 gap-2">
              {notificationPermission !== 'granted' && (
                <Button size="sm" variant="secondary" onClick={requestNotificationPermission}>
                  Enable Notifications
                </Button>
              )}
              <SystemSettingsAction label="Open Notification Settings" onClick={openNotificationSettings} />
            </div>
          </div>
          <p className="text-[11px] text-text-faint">
            macOS doesn't always let apps see whether notifications were actually denied — if a reminder never
            appears, use "Open Notification Settings" to check directly in System Settings.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification thresholds</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <Bell size={13} /> Notify when free space drops below
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={draft.thresholdFreeGb}
                onChange={(e) => update({ thresholdFreeGb: Number(e.target.value) })}
                className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-right text-[13px] text-text"
              />
              <span className="text-[12px] text-text-muted">GB</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <Bell size={13} /> Notify when reclaimable space exceeds
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={draft.thresholdReclaimableGb}
                onChange={(e) => update({ thresholdReclaimableGb: Number(e.target.value) })}
                className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-right text-[13px] text-text"
              />
              <span className="text-[12px] text-text-muted">GB</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-3 opacity-60">
            <p className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <Mail size={13} /> Weekly email summary
            </p>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-text-faint">Coming later</span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 text-[12px] text-text-muted">
          <div className="flex items-center justify-between">
            <span>Last run</span>
            <span className="font-medium text-text">{draft.lastRunAt ? formatDateTime(draft.lastRunAt) : 'Never'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Next run</span>
            <span className="font-medium text-text">
              {draft.enabled && draft.nextRunAt ? formatDateTime(draft.nextRunAt) : 'Not scheduled'}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="flex items-center gap-1.5">
              <Radio size={12} /> Background scheduler
            </span>
            <span
              className={clsx(
                'font-medium',
                !draft.enabled ? 'text-text-faint' : scheduleInstalled ? 'text-safe' : 'text-protected',
              )}
            >
              {!draft.enabled ? 'Off' : scheduleInstalled ? 'Active' : 'Not installed — try saving again'}
            </span>
          </div>
        </CardBody>
      </Card>

      {scanEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent scan activity</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {scanEvents.slice(0, 5).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <HistoryIcon size={13} className="shrink-0 text-text-faint" />
                  <div>
                    <p className="text-[12px] font-medium text-text">
                      {event.source === 'scheduled' ? 'Scheduled scan' : 'Manual scan'}
                    </p>
                    <p className="text-[11px] text-text-faint">{formatDateTime(event.occurredAt)} · scan only, nothing cleaned</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[12px] font-medium text-text">{formatBytes(event.reclaimableBytes)} reclaimable</p>
                  {event.notificationSent && <p className="text-[11px] text-safe">Notification sent</p>}
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
          Discard
        </Button>
        <Button variant="primary" disabled={!dirty} onClick={handleSave}>
          Save schedule
        </Button>
      </div>
    </div>
  )
}
