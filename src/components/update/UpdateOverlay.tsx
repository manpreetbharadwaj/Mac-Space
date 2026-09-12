import { useUpdateStore } from '@/store/useUpdateStore'
import { UpdateModal } from './UpdateModal'

/**
 * Mounted inside AppShell (alongside ToastStack) — renders whichever update
 * dialog currently applies, if any. The lifecycle hook that drives checks
 * lives in AppShell itself (not here), so it keeps running even while the
 * maintenance screen is shown instead of this overlay — see AppShell.tsx.
 * Maintenance mode itself is a full-app takeover, not an overlay on top of
 * the app, so it's handled separately in AppShell.
 */
export function UpdateOverlay() {
  const policy = useUpdateStore((s) => s.policy)
  const dismissedOptionalVersion = useUpdateStore((s) => s.dismissedOptionalVersion)

  if (policy.kind === 'mandatory') return <UpdateModal variant="mandatory" />
  if (policy.kind === 'optional' && policy.latestVersion !== dismissedOptionalVersion) {
    return <UpdateModal variant="optional" />
  }
  return null
}
