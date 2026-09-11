import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { clsx } from 'clsx'

const ICONS = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
}

export function ToastStack() {
  const toasts = useAppStore((s) => s.toasts)
  const dismissToast = useAppStore((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone]
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg"
              onClick={() => dismissToast(toast.id)}
            >
              <Icon
                size={17}
                className={clsx(
                  'mt-0.5 shrink-0',
                  toast.tone === 'success' && 'text-safe',
                  toast.tone === 'warning' && 'text-review',
                  toast.tone === 'default' && 'text-accent',
                )}
              />
              <p className="text-[13px] leading-snug text-text">{toast.message}</p>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
