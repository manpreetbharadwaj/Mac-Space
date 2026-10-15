import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Moon, Sun, Monitor, ShieldAlert, X, RotateCcw, RefreshCw, CheckCircle2, AlertTriangle, BellRing, LogIn, Lock } from 'lucide-react'
import { clsx } from 'clsx'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PremiumSwitch } from '@/components/ui/PremiumSwitch'
import { SystemSettingsAction } from '@/components/ui/SystemSettingsAction'
import { Select } from '@/components/ui/Select'
import { Segmented } from '@/components/ui/Segmented'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { useAppStore } from '@/store/useAppStore'
import { useUpdateStore } from '@/store/useUpdateStore'
import { isTauriRuntime } from '@/services/environment'
import {
  getLoginItemStatus,
  getNativeNotificationStatus,
  openLoginItemsSettings,
  sendTestNotification,
  setLoginItemEnabled,
} from '@/services/tauri/bridge'
import type { NativeNotificationStatus, RawLoginItemStatus } from '@/services/tauri/systemTypes'
import { LANGUAGES, LANGUAGE_BY_CODE, detectSystemLanguage, useI18n, type MessageKey } from '@/i18n'
import type { AlertSensitivity, LanguagePreference, PerformanceSettings, Settings, ThemePreference } from '@/types'

/** A setting with its title/description on one side and its control on the other. */
function SettingRow({ title, hint, control, className }: { title: ReactNode; hint?: ReactNode; control: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-[13px] font-medium text-text">{title}</p>
        {hint && <p className="text-[12px] text-text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function UpdateSection() {
  const { t, td, fmt } = useI18n()
  const currentVersion = useUpdateStore((s) => s.currentVersion)
  const policy = useUpdateStore((s) => s.policy)
  const checking = useUpdateStore((s) => s.checking)
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt)
  const remoteConfigError = useUpdateStore((s) => s.remoteConfigError)
  const installState = useUpdateStore((s) => s.installState)
  const installError = useUpdateStore((s) => s.installError)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const startUpdate = useUpdateStore((s) => s.startUpdate)

  const latestVersion = policy.kind === 'none' ? currentVersion : policy.latestVersion
  const isBusy = installState === 'downloading' || installState === 'installing'

  const status = (() => {
    if (checking) return { label: t('settings.update.checking'), tone: 'muted' as const }
    if (isBusy) return { label: installState === 'installing' ? t('settings.update.installing') : t('settings.update.downloading'), tone: 'muted' as const }
    if (installState === 'error') return { label: t('settings.update.failed'), tone: 'danger' as const }
    if (policy.kind === 'mandatory') return { label: t('settings.update.required'), tone: 'danger' as const }
    if (policy.kind === 'optional') return { label: t('settings.update.available'), tone: 'accent' as const }
    return { label: t('settings.update.upToDate'), tone: 'safe' as const }
  })()

  const statusClass = {
    muted: 'text-text-muted',
    danger: 'text-protected',
    accent: 'text-accent',
    safe: 'text-safe',
  }[status.tone]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.update.title')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="space-y-2 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">{t('settings.update.current')}</span>
            <span className="font-medium text-text">{currentVersion}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">{t('settings.update.latest')}</span>
            <span className="font-medium text-text">{latestVersion}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">{t('settings.update.status')}</span>
            <span className={clsx('flex items-center gap-1.5 font-medium', statusClass)}>
              {status.tone === 'safe' && <CheckCircle2 size={14} />}
              {status.tone === 'danger' && <AlertTriangle size={14} />}
              {status.label}
            </span>
          </div>
          {lastCheckedAt && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">{t('settings.update.lastChecked')}</span>
              <span className="text-text-faint">{fmt.dateTime(new Date(lastCheckedAt).getTime())}</span>
            </div>
          )}
        </div>

        {installState === 'error' && installError && (
          <p className="rounded-lg bg-protected-soft p-2.5 text-[12px] text-text">{td(installError)}</p>
        )}
        {remoteConfigError && !checking && (
          <p className="rounded-lg bg-surface-2 p-2.5 text-[12px] text-text-faint">{t('settings.update.unreachable')}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => checkForUpdates({ force: true })} disabled={checking || isBusy}>
            <RefreshCw size={14} className={checking ? 'animate-spin' : undefined} />
            {t('settings.update.check')}
          </Button>
          {(policy.kind === 'optional' || policy.kind === 'mandatory' || installState === 'error') && (
            <Button variant="primary" onClick={startUpdate} disabled={isBusy}>
              {installState === 'error' ? t('settings.update.retry') : t('settings.update.now')}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function LaunchAtLoginRow() {
  const { t } = useI18n()
  const desktop = isTauriRuntime()
  const [status, setStatus] = useState<RawLoginItemStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (desktop) void getLoginItemStatus().then(setStatus).catch(() => {})
  }, [desktop])

  const unavailableHint =
    !desktop || status?.detail === 'devBuild'
      ? t('settings.launchUnavailableDev')
      : status?.detail === 'requiresMacOS13'
        ? t('settings.launchUnavailableOS')
        : null
  const unavailable = !desktop || status?.state === 'unavailable'

  return (
    <SettingRow
      title={
        <span className="flex items-center gap-2">
          <LogIn size={14} className="text-text-faint" />
          {t('settings.launchAtLogin')}
        </span>
      }
      hint={
        <>
          {t('settings.launchAtLoginHint')}
          {unavailable && unavailableHint && <span className="block text-text-faint">{unavailableHint}</span>}
          {status?.state === 'requiresApproval' && <span className="block text-review">{t('settings.launchRequiresApproval')}</span>}
          {status?.detail && status.state !== 'unavailable' && <span className="block text-protected">{status.detail}</span>}
        </>
      }
      control={
        <div className="flex items-center gap-2">
          {status?.state === 'requiresApproval' && (
            <SystemSettingsAction label={t('settings.openLoginItems')} icon={LogIn} onClick={() => void openLoginItemsSettings()} />
          )}
          <PremiumSwitch
            checked={status?.state === 'enabled' || status?.state === 'requiresApproval'}
            disabled={unavailable || busy || !status}
            label={t('settings.launchAtLogin')}
            onChange={async (v) => {
              setBusy(true)
              try {
                setStatus(await setLoginItemEnabled(v))
              } finally {
                setBusy(false)
              }
            }}
          />
        </div>
      }
    />
  )
}

const PERMISSION_TONE: Record<NativeNotificationStatus, StatusTone> = {
  authorized: 'good',
  provisional: 'good',
  ephemeral: 'good',
  denied: 'attention',
  notDetermined: 'fair',
  unknown: 'neutral',
  unavailable: 'neutral',
}

function NotificationsSection({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const { t, fmt } = useI18n()
  const desktop = isTauriRuntime()
  const openNotificationSettings = useAppStore((s) => s.openNotificationSettings)
  const mockPermission = useAppStore((s) => s.notificationPermission)
  const [nativeStatus, setNativeStatus] = useState<NativeNotificationStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ tone: 'safe' | 'danger' | 'muted'; text: string } | null>(null)
  const perf = settings.performance
  const setPerf = (patch: Partial<PerformanceSettings>) => save({ ...settings, performance: { ...perf, ...patch } })

  const refreshStatus = useCallback(() => {
    if (desktop) void getNativeNotificationStatus().then(setNativeStatus).catch(() => setNativeStatus('unknown'))
  }, [desktop])
  useEffect(() => {
    refreshStatus()
    // Re-check when the user comes back from System Settings.
    window.addEventListener('focus', refreshStatus)
    return () => window.removeEventListener('focus', refreshStatus)
  }, [refreshStatus])

  const status: NativeNotificationStatus | null = desktop
    ? nativeStatus
    : mockPermission === 'granted'
      ? 'authorized'
      : mockPermission === 'denied'
        ? 'denied'
        : 'notDetermined'

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await sendTestNotification(t('notify.testTitle'), t('notify.testBody'))
      setTestResult(
        result.outcome === 'sent'
          ? { tone: 'safe', text: t('settings.test.sent') }
          : result.outcome === 'denied'
            ? { tone: 'danger', text: t('settings.test.denied') }
            : result.outcome === 'unavailable'
              ? { tone: 'muted', text: t('settings.test.unavailable') }
              : { tone: 'danger', text: t('settings.test.failed') },
      )
      if (result.authorization) setNativeStatus(result.authorization)
    } catch (e) {
      setTestResult({ tone: 'danger', text: t('common.error', { error: String(e) }) })
    } finally {
      setTesting(false)
    }
  }

  const alertToggles: { key: keyof PerformanceSettings; label: MessageKey }[] = [
    { key: 'memoryAlert', label: 'settings.memoryAlerts' },
    { key: 'cpuAlert', label: 'settings.cpuAlerts' },
    { key: 'storageAlert', label: 'settings.storageAlerts' },
    { key: 'appAlert', label: 'settings.appAlerts' },
    { key: 'batteryAlert', label: 'settings.batteryAlerts' },
  ]
  const cooldownOptions = [15, 30, 60, 180, 360].map((m) => ({
    value: m,
    label: m < 60 ? t('settings.minutes', { value: m }) : t('settings.hours', { value: fmt.number(m / 60) }),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.notifications')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <SettingRow
          title={t('settings.notificationsEnabled')}
          hint={t('settings.notificationsEnabledHint')}
          control={<PremiumSwitch checked={settings.notificationsEnabled} onChange={(v) => save({ ...settings, notificationsEnabled: v })} label={t('settings.notificationsEnabled')} />}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 p-2.5">
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            {t('settings.permission')}
            {status ? <StatusChip tone={PERMISSION_TONE[status]} label={t(`settings.perm.${status}`)} /> : <span>{t('common.loading')}</span>}
          </p>
          <SystemSettingsAction label={t('settings.openNotificationSettings')} onClick={openNotificationSettings} />
        </div>

        <div className={clsx('space-y-3 border-t border-border pt-4', !settings.notificationsEnabled && 'opacity-50')}>
          {alertToggles.map((item) => (
            <SettingRow
              key={item.key}
              title={t(item.label)}
              control={
                <PremiumSwitch
                  checked={Boolean(perf[item.key])}
                  disabled={!settings.notificationsEnabled}
                  onChange={(v) => setPerf({ [item.key]: v } as Partial<PerformanceSettings>)}
                  label={t(item.label)}
                />
              }
            />
          ))}
          <SettingRow
            title={t('settings.cooldown')}
            hint={t('settings.cooldownHint')}
            control={
              <Select
                label={t('settings.cooldown')}
                value={perf.cooldownMinutes}
                options={cooldownOptions}
                disabled={!settings.notificationsEnabled}
                onChange={(v) => setPerf({ cooldownMinutes: v })}
              />
            }
          />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Button variant="secondary" size="sm" onClick={() => void runTest()} disabled={testing || !desktop}>
            <BellRing size={14} />
            {t('settings.testNotification')}
          </Button>
          {!desktop && <p className="text-[12px] text-text-faint">{t('settings.test.unavailable')}</p>}
          {testResult && (
            <p
              role="status"
              className={clsx(
                'rounded-lg p-2.5 text-[12px]',
                testResult.tone === 'safe' && 'bg-safe-soft text-text',
                testResult.tone === 'danger' && 'bg-protected-soft text-text',
                testResult.tone === 'muted' && 'bg-surface-2 text-text-muted',
              )}
            >
              {testResult.text}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function PerformanceSection({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const { t } = useI18n()
  const perf = settings.performance
  const setPerf = (patch: Partial<PerformanceSettings>) => save({ ...settings, performance: { ...perf, ...patch } })
  const off = !perf.monitoringEnabled

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.performance')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <SettingRow
          title={t('settings.monitoring')}
          hint={t('settings.monitoringHint')}
          control={<PremiumSwitch checked={perf.monitoringEnabled} onChange={(v) => setPerf({ monitoringEnabled: v })} label={t('settings.monitoring')} />}
        />
        <div className={clsx('space-y-4 border-t border-border pt-4', off && 'pointer-events-none opacity-50')} aria-disabled={off}>
          <SettingRow
            title={t('settings.refreshInterval')}
            control={
              <Select
                label={t('settings.refreshInterval')}
                value={perf.refreshIntervalSec}
                disabled={off}
                options={[1, 2, 3, 5, 10].map((s) => ({ value: s, label: t('settings.seconds', { value: s }) }))}
                onChange={(v) => setPerf({ refreshIntervalSec: v })}
              />
            }
          />
          <SettingRow
            title={t('settings.memoryAlert')}
            control={<PremiumSwitch checked={perf.memoryAlert} disabled={off} onChange={(v) => setPerf({ memoryAlert: v })} label={t('settings.memoryAlert')} />}
          />
          <SettingRow
            title={t('settings.cpuAlert')}
            control={<PremiumSwitch checked={perf.cpuAlert} disabled={off} onChange={(v) => setPerf({ cpuAlert: v })} label={t('settings.cpuAlert')} />}
          />
          <SettingRow
            title={t('settings.appAlert')}
            hint={t('settings.appAlertHint')}
            control={<PremiumSwitch checked={perf.appAlert} disabled={off} onChange={(v) => setPerf({ appAlert: v })} label={t('settings.appAlert')} />}
          />
          <SettingRow
            title={t('settings.sensitivity')}
            hint={t(`settings.sensitivityHint.${perf.sensitivity}`)}
            control={
              <Segmented<AlertSensitivity>
                size="sm"
                label={t('settings.sensitivity')}
                value={perf.sensitivity}
                onChange={(v) => setPerf({ sensitivity: v })}
                options={(['low', 'balanced', 'high'] as const).map((v) => ({ value: v, label: t(`settings.sensitivity.${v}`) }))}
              />
            }
          />
          <SettingRow
            title={t('settings.cpuThreshold')}
            control={
              <Select
                label={t('settings.cpuThreshold')}
                value={perf.cpuThresholdPercent}
                disabled={off}
                options={[70, 80, 85, 90, 95].map((v) => ({ value: v, label: t('settings.percent', { value: v }) }))}
                onChange={(v) => setPerf({ cpuThresholdPercent: v })}
              />
            }
          />
          <SettingRow
            title={t('settings.appMemoryThreshold')}
            control={
              <Select
                label={t('settings.appMemoryThreshold')}
                value={perf.appMemoryThresholdGb}
                disabled={off}
                options={[1, 2, 3, 4, 6, 8, 12, 16].map((v) => ({ value: v, label: t('settings.gb', { value: v }) }))}
                onChange={(v) => setPerf({ appMemoryThresholdGb: v })}
              />
            }
          />
          <SettingRow
            title={t('settings.storageThreshold')}
            control={
              <Select
                label={t('settings.storageThreshold')}
                value={perf.storageFreeThresholdGb}
                disabled={off}
                options={[5, 10, 20, 30, 50].map((v) => ({ value: v, label: t('settings.gb', { value: v }) }))}
                onChange={(v) => setPerf({ storageFreeThresholdGb: v })}
              />
            }
          />
        </div>
      </CardBody>
    </Card>
  )
}

const PERMISSION_CLASS = {
  granted: 'bg-safe-soft text-safe',
  denied: 'bg-protected-soft text-protected',
  'not-requested': 'bg-surface-2 text-text-faint',
} as const

export function SettingsPage() {
  const { t, td } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const permissions = useAppStore((s) => s.permissions)
  const requestPermission = useAppStore((s) => s.requestPermission)
  const resetDemoData = useAppStore((s) => s.resetDemoData)
  const [newExclusion, setNewExclusion] = useState('')

  if (!settings) return null
  const current = settings
  const save = (next: Settings) => void saveSettings(next)

  const addExclusion = () => {
    if (!newExclusion.trim()) return
    save({ ...current, exclusions: [...current.exclusions, newExclusion.trim()] })
    setNewExclusion('')
  }

  const removeExclusion = (path: string) => {
    save({ ...current, exclusions: current.exclusions.filter((p) => p !== path) })
  }

  const systemLanguage = LANGUAGE_BY_CODE[detectSystemLanguage()].nativeName
  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t('settings.languageSystem', { language: systemLanguage }) },
    ...LANGUAGES.map((l) => ({ value: l.code as LanguagePreference, label: l.nativeName })),
  ]

  return (
    <div className="max-w-2xl space-y-5 pb-16">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.general')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <LaunchAtLoginRow />
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[13px] font-medium text-text">{t('settings.appearance')}</p>
            <div className="flex gap-2">
              {(
                [
                  { key: 'light' as ThemePreference, label: t('settings.theme.light'), icon: Sun },
                  { key: 'dark' as ThemePreference, label: t('settings.theme.dark'), icon: Moon },
                  { key: 'system' as ThemePreference, label: t('settings.theme.system'), icon: Monitor },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={settings.theme === opt.key}
                  onClick={() => save({ ...current, theme: opt.key })}
                  className={clsx(
                    'flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-[12px] font-medium transition-colors',
                    settings.theme === opt.key ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted hover:text-text',
                  )}
                >
                  <opt.icon size={16} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.languageRegion')}</CardTitle>
        </CardHeader>
        <CardBody>
          <SettingRow
            title={t('settings.language')}
            hint={t('settings.languageHint')}
            control={
              <Select<LanguagePreference>
                label={t('settings.language')}
                value={settings.language}
                options={languageOptions}
                onChange={(v) => save({ ...current, language: v })}
                className="min-w-[200px]"
              />
            }
          />
        </CardBody>
      </Card>

      <PerformanceSection settings={current} save={save} />
      <NotificationsSection settings={current} save={save} />

      <UpdateSection />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.cleanup')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <SettingRow
            title={t('settings.permanentDelete')}
            hint={t('settings.permanentDeleteHint')}
            control={
              <PremiumSwitch
                checked={settings.permanentDeleteEnabled}
                onChange={(v) => save({ ...current, permanentDeleteEnabled: v })}
                label={t('settings.permanentDelete')}
                tone="danger"
              />
            }
          />
          {settings.permanentDeleteEnabled && (
            <div className="flex items-center gap-2 rounded-lg bg-protected-soft p-2.5 text-[12px] text-text">
              <ShieldAlert size={14} className="shrink-0 text-protected" />
              {t('settings.permanentDeleteWarning')}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.privacy')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <SettingRow
            title={t('settings.analytics')}
            hint={t('settings.analyticsHint')}
            control={<PremiumSwitch checked={settings.analyticsOptIn} onChange={(v) => save({ ...current, analyticsOptIn: v })} label={t('settings.analytics')} />}
          />
          <div className="space-y-2 rounded-lg bg-surface-2 p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-text">
              <Lock size={13} className="text-safe" />
              {t('settings.privacyLocal')}
            </p>
            <p className="text-[12px] text-text-muted">{t('settings.privacyLocalBody')}</p>
            <p className="text-[12px] text-text-muted">{t('settings.privacyNoTelemetry')}</p>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-text-muted">{t('settings.privacyPermissions')}</p>
            <ul className="list-disc space-y-1 ps-5 text-[12px] text-text-muted">
              <li>{t('settings.privacyPermFDA')}</li>
              <li>{t('settings.privacyPermNotifications')}</li>
              <li>{t('settings.privacyPermAutomation')}</li>
            </ul>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.permissions')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {permissions.map((permission) => (
            <div key={permission.category} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text">{td(permission.label)}</p>
                <p className="text-[12px] text-text-muted">{td(permission.reason)}</p>
              </div>
              {permission.state === 'granted' ? (
                <span className={clsx('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium', PERMISSION_CLASS.granted)}>
                  {t('settings.permissions.granted')}
                </span>
              ) : (
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => requestPermission(permission.category)}>
                  {permission.state === 'denied' ? t('settings.permissions.open') : t('settings.permissions.request')}
                </Button>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.exclusions')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-[12px] text-text-muted">{t('settings.exclusionsHint')}</p>
          <div className="flex gap-2">
            <input
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
              placeholder="~/Projects/my-active-app"
              dir="ltr"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] text-text placeholder:text-text-faint"
            />
            <Button variant="secondary" onClick={addExclusion}>
              {t('settings.exclusionsAdd')}
            </Button>
          </div>
          {settings.exclusions.length === 0 ? (
            <p className="text-[12px] text-text-faint">{t('settings.exclusionsEmpty')}</p>
          ) : (
            <ul className="space-y-1.5">
              {settings.exclusions.map((path) => (
                <li key={path} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <span className="truncate text-[12px] text-text-muted" dir="ltr">
                    {path}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeExclusion(path)}
                    className="shrink-0 text-text-faint hover:text-text"
                    aria-label={t('settings.exclusionsRemove', { path })}
                  >
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
              <p className="text-[13px] font-medium text-text">{t('settings.resetDemo')}</p>
              <p className="text-[12px] text-text-muted">{t('settings.resetDemoHint')}</p>
            </div>
            <Button variant="secondary" onClick={resetDemoData}>
              <RotateCcw size={14} />
              {t('settings.reset')}
            </Button>
          </CardBody>
        </Card>
    </div>
  )
}
