import { Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { clsx } from 'clsx'
import { Sidebar } from './Sidebar'
import { ToastStack } from '@/components/ui/ToastStack'
import { CleanupActionBar } from '@/components/cleanup/CleanupActionBar'
import { MaintenanceScreen } from '@/components/update/MaintenanceScreen'
import { UpdateOverlay } from '@/components/update/UpdateOverlay'
import { StartupScreen } from '@/components/startup/StartupScreen'
import { useAppStore } from '@/store/useAppStore'
import { useUpdateStore } from '@/store/useUpdateStore'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useUpdateLifecycle } from '@/hooks/useUpdateLifecycle'
import { useNotificationRouteHandoff } from '@/hooks/useNotificationRouteHandoff'

/** How long the storage ring gets to settle into real category proportions before the startup screen recedes — see StartupScreen's `revealed` prop. Not a data-loading delay: `ready` (and the real dashboard mounting behind it) already happened by the time this timer starts. */
const SETTLE_MS = 550

export function AppShell() {
  const ready = useAppStore((s) => s.ready)
  const settings = useAppStore((s) => s.settings)
  const init = useAppStore((s) => s.init)
  const initStepsDone = useAppStore((s) => s.initStepsDone)
  const categories = useAppStore((s) => s.categories)
  const hasSelection = useAppStore((s) => s.selectedIds.size > 0)
  const maintenanceActive = useUpdateStore((s) => s.maintenanceActive)
  const [showStartup, setShowStartup] = useState(true)

  useThemeSync(settings?.theme)
  // Kept at this level (not inside UpdateOverlay) so update/maintenance
  // checks keep running even while the maintenance takeover screen below
  // replaces the rest of this component's output.
  useUpdateLifecycle()
  // Needs react-router's context (AppShell renders inside <HashRouter>), and
  // must run regardless of `ready`/maintenance state below so a route from a
  // cold-launch notification click is never missed.
  useNotificationRouteHandoff()

  useEffect(() => {
    init()
  }, [init])

  // The dashboard behind it (below) already mounts and fades in the instant
  // `ready` flips true — this only delays *removing the startup screen*, so
  // the ring gets a brief, honest moment to settle into real category
  // proportions before receding, instead of vanishing the instant data
  // arrives. See StartupScreen/StorageRing for what "settle" means.
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => setShowStartup(false), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [ready])

  return (
    <>
      {ready &&
        (maintenanceActive ? (
          <MaintenanceScreen />
        ) : (
          <motion.div
            className="flex h-screen w-full overflow-hidden bg-canvas text-text"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Sidebar />
            <main className={clsx('flex-1 overflow-y-auto transition-[padding]', hasSelection && 'pb-24')}>
              <div className="mx-auto min-h-full max-w-[1400px] px-8 py-7">
                <Outlet />
              </div>
            </main>
            <CleanupActionBar />
            <ToastStack />
            <UpdateOverlay />
          </motion.div>
        ))}

      <AnimatePresence>
        {showStartup && <StartupScreen key="startup" revealed={ready} categories={categories} initStepsDone={initStepsDone} />}
      </AnimatePresence>
    </>
  )
}
