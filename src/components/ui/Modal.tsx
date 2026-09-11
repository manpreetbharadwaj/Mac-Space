import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}) {
  const widthClass = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-2xl' }[width]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={`w-full ${widthClass} overflow-hidden rounded-2xl border border-border bg-surface shadow-xl`}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-[15px] font-semibold text-text">{title}</h2>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
