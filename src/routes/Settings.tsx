import { useState } from 'react'
import { Moon, Sun, Monitor, ShieldAlert, X, RotateCcw } from 'lucide-react'
import { clsx } from 'clsx'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store/useAppStore'
import type { ThemePreference } from '@/types'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-2')}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

const PERMISSION_LABEL = { granted: 'Granted', denied: 'Denied', 'not-requested': 'Not requested' } as const
const PERMISSION_CLASS = {
  granted: 'bg-safe-soft text-safe',
  denied: 'bg-protected-soft text-protected',
  'not-requested': 'bg-surface-2 text-text-faint',
} as const

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const permissions = useAppStore((s) => s.permissions)
  const requestPermission = useAppStore((s) => s.requestPermission)
  const resetDemoData = useAppStore((s) => s.resetDemoData)
  const [newExclusion, setNewExclusion] = useState('')

  if (!settings) return null
  const current = settings

  const addExclusion = () => {
    if (!newExclusion.trim()) return
    saveSettings({ ...current, exclusions: [...current.exclusions, newExclusion.trim()] })
    setNewExclusion('')
  }

  const removeExclusion = (path: string) => {
    saveSettings({ ...current, exclusions: current.exclusions.filter((p) => p !== path) })
  }

  return (
    <div className="max-w-2xl space-y-5 pb-16">
      <PageHeader title="Settings" description="Exclusions, cleanup behavior, notifications, and privacy — all local to this Mac." />

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardBody className="flex gap-2">
          {(
            [
              { key: 'light' as ThemePreference, label: 'Light', icon: Sun },
              { key: 'dark' as ThemePreference, label: 'Dark', icon: Moon },
              { key: 'system' as ThemePreference, label: 'System', icon: Monitor },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => saveSettings({ ...current, theme: opt.key })}
              className={clsx(
                'flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-[12px] font-medium transition-colors',
                settings.theme === opt.key ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted hover:text-text',
              )}
            >
              <opt.icon size={16} />
              {opt.label}
            </button>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cleanup behavior</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-text">Allow permanent deletion</p>
              <p className="text-[12px] text-text-muted">
                Adds an advanced "delete permanently" option to the cleanup review — off by default.
              </p>
            </div>
            <Toggle
              checked={settings.permanentDeleteEnabled}
              onChange={(v) => saveSettings({ ...current, permanentDeleteEnabled: v })}
            />
          </div>
          {settings.permanentDeleteEnabled && (
            <div className="flex items-center gap-2 rounded-lg bg-protected-soft p-2.5 text-[12px] text-text">
              <ShieldAlert size={14} className="shrink-0 text-protected" />
              Permanently deleted items cannot be recovered from Trash.
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <p className="text-[13px] font-medium text-text">Notifications</p>
              <p className="text-[12px] text-text-muted">Threshold alerts and scheduled scan results.</p>
            </div>
            <Toggle
              checked={settings.notificationsEnabled}
              onChange={(v) => saveSettings({ ...current, notificationsEnabled: v })}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-text">Share anonymous product analytics</p>
              <p className="text-[12px] text-text-muted">
                Scan duration, feature usage, and error codes only — never file names, paths, or contents.
              </p>
            </div>
            <Toggle checked={settings.analyticsOptIn} onChange={(v) => saveSettings({ ...current, analyticsOptIn: v })} />
          </div>
          <p className="rounded-lg bg-surface-2 p-3 text-[12px] text-text-muted">
            Scanning and classification happen entirely on this Mac. Nothing about your files is uploaded — this
            prototype has no network or cloud features at all.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {permissions.map((permission) => (
            <div key={permission.category} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text">{permission.label}</p>
                <p className="text-[12px] text-text-muted">{permission.reason}</p>
              </div>
              {permission.state === 'granted' ? (
                <span className={clsx('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium', PERMISSION_CLASS.granted)}>
                  {PERMISSION_LABEL.granted}
                </span>
              ) : (
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => requestPermission(permission.category)}>
                  {permission.state === 'denied' ? 'Open Settings' : 'Request Access'}
                </Button>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exclusions</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-[12px] text-text-muted">
            Paths, apps, or projects you never want to see in cleanup recommendations.
          </p>
          <div className="flex gap-2">
            <input
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
              placeholder="~/Projects/my-active-app"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] text-text placeholder:text-text-faint"
            />
            <Button variant="secondary" onClick={addExclusion}>
              Add
            </Button>
          </div>
          {settings.exclusions.length === 0 ? (
            <p className="text-[12px] text-text-faint">No exclusions yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {settings.exclusions.map((path) => (
                <li key={path} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <span className="truncate text-[12px] text-text-muted">{path}</span>
                  <button onClick={() => removeExclusion(path)} className="shrink-0 text-text-faint hover:text-text">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="border-dashed">
        <CardBody className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-text">Reset demo data</p>
            <p className="text-[12px] text-text-muted">Restores the original mock storage, history, and settings.</p>
          </div>
          <Button variant="secondary" onClick={resetDemoData}>
            <RotateCcw size={14} />
            Reset
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
