import { useEffect, useState } from 'react'
import { Bell, Mail, ShieldCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store/useAppStore'
import { formatDateTime } from '@/lib/format'
import { CATEGORY_LABELS, DASHBOARD_CATEGORY_ORDER } from '@/mocks'
import type { ScheduleFrequency, ScheduleMode, ScheduleRule, StorageCategoryId } from '@/types'

const FREQUENCIES: { key: ScheduleFrequency; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Biweekly' },
  { key: 'monthly', label: 'Monthly' },
]

export function Schedule() {
  const schedule = useAppStore((s) => s.schedule)
  const saveSchedule = useAppStore((s) => s.saveSchedule)
  const [draft, setDraft] = useState<ScheduleRule | null>(schedule)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (schedule && !dirty) setDraft(schedule)
  }, [schedule, dirty])

  if (!draft) return null
  const current = draft

  const update = (patch: Partial<ScheduleRule>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
    setDirty(true)
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
            <p className="text-[12px] text-text-muted">Turn on automatic scanning on a recurring cadence.</p>
          </div>
          <button
            onClick={() => update({ enabled: !draft.enabled })}
            className={clsx(
              'relative h-6 w-11 rounded-full transition-colors',
              draft.enabled ? 'bg-accent' : 'bg-surface-2',
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                draft.enabled ? 'translate-x-5' : 'translate-x-0.5',
              )}
            />
          </button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Frequency</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          {FREQUENCIES.map((f) => (
            <button
              key={f.key}
              onClick={() => update({ frequency: f.key })}
              className={clsx(
                'rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors',
                draft.frequency === f.key ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted hover:text-text',
              )}
            >
              {f.label}
            </button>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mode</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {(
            [
              { key: 'reminder' as ScheduleMode, label: 'Reminder only', desc: 'Notify me — I will review and clean manually.' },
              { key: 'auto-clean' as ScheduleMode, label: 'Auto-clean Safe items', desc: 'Automatically clean Green-labeled items only.' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => update({ mode: opt.key })}
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
              <div>
                <p className="text-[13px] font-medium text-text">{opt.label}</p>
                <p className="text-[12px] text-text-muted">{opt.desc}</p>
              </div>
            </button>
          ))}

          {draft.mode === 'auto-clean' && (
            <div className="rounded-xl border border-border p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text">
                <ShieldCheck size={13} className="text-safe" />
                Categories eligible for auto-clean
              </p>
              <div className="flex flex-wrap gap-2">
                {DASHBOARD_CATEGORY_ORDER.map((id) => (
                  <button
                    key={id}
                    onClick={() => toggleCategory(id)}
                    className={clsx(
                      'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                      draft.safeCategories.includes(id)
                        ? 'border-safe bg-safe-soft text-safe'
                        : 'border-border text-text-muted hover:text-text',
                    )}
                  >
                    {CATEGORY_LABELS[id]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-text-faint">
                Only items marked Safe are ever cleaned automatically, regardless of category.
              </p>
            </div>
          )}
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
        <CardBody className="flex items-center justify-between text-[12px] text-text-muted">
          <span>Last run: {draft.lastRunAt ? formatDateTime(draft.lastRunAt) : 'Never'}</span>
          <span>Next run: {draft.enabled && draft.nextRunAt ? formatDateTime(draft.nextRunAt) : 'Not scheduled'}</span>
        </CardBody>
      </Card>

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
