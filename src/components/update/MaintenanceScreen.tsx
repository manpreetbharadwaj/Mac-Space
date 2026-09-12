import { Wrench } from 'lucide-react'
import { useUpdateStore } from '@/store/useUpdateStore'

/**
 * Full-app takeover shown only when Remote Config's maintenance_mode is true
 * from a successfully fetched/cached value (never from defaults — see
 * computeMaintenanceActive in services/updatePolicy.ts). Deliberately has no
 * dismiss action; it clears itself automatically once maintenance_mode is
 * turned back off remotely and the app re-checks.
 */
export function MaintenanceScreen() {
  const remoteConfig = useUpdateStore((s) => s.remoteConfig)

  return (
    <div className="flex h-screen w-full items-center justify-center bg-canvas px-6 text-text">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-review-soft text-review">
          <Wrench size={22} />
        </div>
        <h1 className="text-[17px] font-semibold text-text">{remoteConfig.maintenance_title || 'Under Maintenance'}</h1>
        <p className="text-[13px] text-text-muted">
          {remoteConfig.maintenance_message || 'Mac Storage Manager is temporarily unavailable. Please try again shortly.'}
        </p>
      </div>
    </div>
  )
}
