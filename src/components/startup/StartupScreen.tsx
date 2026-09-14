import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { HardDrive } from 'lucide-react'
import type { StorageCategory } from '@/types'
import type { InitStepKey } from '@/lib/startupStages'
import { deriveStartupLabel } from '@/lib/startupStages'
import { StorageRing } from './StorageRing'

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]
const EASE_IN: [number, number, number, number] = [0.5, 0, 1, 1]

/**
 * Full-screen startup experience shown while `useAppStore.init()` is
 * in flight. Deliberately has no numeric progress — see StorageRing and
 * deriveStartupLabel for why: this app's init is 13 parallel calls with no
 * honest single "% complete" figure, so the ring communicates "working"
 * structurally (an indeterminate sweep) while the label names real,
 * currently-pending work.
 */
export function StartupScreen({
  revealed,
  categories,
  initStepsDone,
}: {
  /** True once real data is in — shows the ring settling into true category proportions before this screen is removed. */
  revealed: boolean
  categories: StorageCategory[]
  initStepsDone: Record<InitStepKey, boolean>
}) {
  const reducedMotion = useReducedMotion() ?? false
  const label = revealed ? 'Preparing your dashboard…' : deriveStartupLabel(initStepsDone)

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-canvas"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={
        reducedMotion
          ? { opacity: 0, transition: { duration: 0.2 } }
          : { opacity: 0, scale: 1.03, filter: 'blur(8px)', transition: { duration: 0.5, ease: EASE_IN } }
      }
      transition={{ duration: 0.3, ease: EASE_OUT }}
    >
      <div className="flex flex-col items-center gap-7">
        <div className="relative flex items-center justify-center">
          <StorageRing categories={categories} revealed={revealed} scanning={!revealed} reducedMotion={reducedMotion} />

          {/* Identity mark — deliberately small and centered inside the ring
              rather than the hero of the screen, so a real logo can drop in
              here later without needing to redesign anything around it. A
              faint inner highlight + soft cast shadow read as a physical
              badge rather than a flat color swatch. */}
          <motion.div
            className="absolute flex h-10 w-10 items-center justify-center rounded-[11px] bg-accent text-accent-contrast"
            style={{
              backgroundImage: 'linear-gradient(180deg, rgb(255 255 255 / 0.16), transparent 55%)',
              boxShadow:
                'inset 0 1px 0 0 rgb(255 255 255 / 0.22), inset 0 -1px 1px 0 rgb(0 0 0 / 0.12), 0 6px 14px -6px rgb(0 0 0 / 0.35)',
            }}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reducedMotion ? 0.2 : 0.5, delay: reducedMotion ? 0 : 0.1, ease: EASE_OUT }}
          >
            <HardDrive size={18} strokeWidth={2} />
          </motion.div>
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <motion.p
            className="text-[14px] font-semibold tracking-tight text-text"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0.2 : 0.45, delay: reducedMotion ? 0.05 : 0.28, ease: EASE_OUT }}
          >
            Mac Storage Manager
          </motion.p>

          <motion.div
            className="relative flex h-4 w-80 items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reducedMotion ? 0.2 : 0.4, delay: reducedMotion ? 0.1 : 0.42, ease: EASE_OUT }}
          >
            <AnimatePresence>
              <motion.p
                key={label}
                className="absolute inset-0 flex items-center justify-center text-[11px] font-medium uppercase tracking-[0.09em] text-text-faint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reducedMotion ? 0.12 : 0.35, ease: EASE_OUT }}
              >
                {label}
              </motion.p>
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
