import { AlertTriangle, Download, RotateCcw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useUpdateStore } from '@/store/useUpdateStore'

/**
 * Renders the mandatory (non-dismissible) or optional (dismissible)
 * update dialog. Which variant shows, and whether it shows at all, is
 * decided by the caller (UpdateController) from useUpdateStore's `policy` —
 * this component only knows how to present whatever it's told to.
 */
export function UpdateModal({ variant }: { variant: 'optional' | 'mandatory' }) {
  const policy = useUpdateStore((s) => s.policy)
  const remoteConfig = useUpdateStore((s) => s.remoteConfig)
  const nativeUpdate = useUpdateStore((s) => s.nativeUpdate)
  const installState = useUpdateStore((s) => s.installState)
  const installProgress = useUpdateStore((s) => s.installProgress)
  const installError = useUpdateStore((s) => s.installError)
  const startUpdate = useUpdateStore((s) => s.startUpdate)
  const dismissOptionalUpdate = useUpdateStore((s) => s.dismissOptionalUpdate)

  if (policy.kind === 'none') return null

  const title = variant === 'mandatory' ? 'Update Required' : remoteConfig.update_title || 'New Version Available'
  const releaseNotes = nativeUpdate?.body?.trim()
  const isBusy = installState === 'downloading' || installState === 'installing'

  const body = (
    <div className="space-y-4">
      {variant === 'mandatory' ? (
        <p className="text-[13px] text-text-muted">
          {policy.kind === 'mandatory' && policy.reason === 'minimum-version'
            ? 'This version of the app is no longer supported. Please update to continue.'
            : remoteConfig.update_message || 'This version of the app is no longer supported. Please update to continue.'}
        </p>
      ) : (
        <p className="text-[13px] text-text-muted">
          {remoteConfig.update_message || 'A new version is available.'}
        </p>
      )}

      <p className="text-[13px] font-medium text-text">Version {policy.latestVersion} is available.</p>

      {releaseNotes && (
        <div className="max-h-40 overflow-y-auto rounded-lg bg-surface-2 p-3 text-[12px] text-text-muted whitespace-pre-line">
          {releaseNotes}
        </div>
      )}

      {installState === 'downloading' && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-text-muted">
            Downloading update{installProgress !== null ? `… ${installProgress}%` : '…'}
          </p>
          <ProgressBar value={installProgress ?? 0} />
        </div>
      )}

      {installState === 'installing' && <p className="text-[12px] text-text-muted">Installing update…</p>}

      {installState === 'error' && installError && (
        <div className="flex items-start gap-2 rounded-lg bg-protected-soft p-3 text-[12px] text-text">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-protected" />
          <span>Update could not be downloaded. Please check your internet connection and try again.</span>
        </div>
      )}
    </div>
  )

  const footer = (
    <>
      {variant === 'optional' && installState !== 'downloading' && installState !== 'installing' && (
        <Button variant="ghost" onClick={dismissOptionalUpdate}>
          Later
        </Button>
      )}
      <Button variant="primary" onClick={startUpdate} disabled={isBusy}>
        {installState === 'error' ? (
          <>
            <RotateCcw size={14} />
            Retry
          </>
        ) : isBusy ? (
          installState === 'installing' ? 'Installing…' : 'Downloading…'
        ) : (
          <>
            <Download size={14} />
            Update Now
          </>
        )}
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={variant === 'optional' ? dismissOptionalUpdate : () => {}}
      dismissible={variant === 'optional' && !isBusy}
      title={title}
      footer={footer}
      width="sm"
    >
      {body}
    </Modal>
  )
}
