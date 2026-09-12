import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { clsx } from 'clsx'
import { Sidebar } from './Sidebar'
import { ToastStack } from '@/components/ui/ToastStack'
import { CleanupActionBar } from '@/components/cleanup/CleanupActionBar'
import { MaintenanceScreen } from '@/components/update/MaintenanceScreen'
import { UpdateOverlay } from '@/components/update/UpdateOverlay'
import { useAppStore } from '@/store/useAppStore'
import { useUpdateStore } from '@/store/useUpdateStore'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useUpdateLifecycle } from '@/hooks/useUpdateLifecycle'
import { HardDrive } from 'lucide-react'

export function AppShell() {
  const ready = useAppStore((s) => s.ready)
  const settings = useAppStore((s) => s.settings)
  const init = useAppStore((s) => s.init)
  const hasSelection = useAppStore((s) => s.selectedIds.size > 0)
  const maintenanceActive = useUpdateStore((s) => s.maintenanceActive)

  useThemeSync(settings?.theme)
  // Kept at this level (not inside UpdateOverlay) so update/maintenance
  // checks keep running even while the maintenance takeover screen below
  // replaces the rest of this component's output.
  useUpdateLifecycle()

  useEffect(() => {
    init()
  }, [init])

  if (!ready) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-11 w-11 animate-pulse items-center justify-center rounded-xl bg-accent text-accent-contrast">
            <HardDrive size={20} />
          </div>
          <p className="text-sm text-text-muted">Loading Mac Storage Manager…</p>
        </div>
      </div>
    )
  }

  if (maintenanceActive) {
    return <MaintenanceScreen />
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas text-text">
      <Sidebar />
      <main className={clsx('flex-1 overflow-y-auto transition-[padding]', hasSelection && 'pb-24')}>
        <div className="mx-auto min-h-full max-w-[1400px] px-8 py-7">
          <Outlet />
        </div>
      </main>
      <CleanupActionBar />
      <ToastStack />
      <UpdateOverlay />
    </div>
  )
}
