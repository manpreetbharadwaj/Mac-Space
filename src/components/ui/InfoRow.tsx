import type { ReactNode } from 'react'
import { clsx } from 'clsx'

/** One label/value line, as used throughout Settings and Mac Health. */
export function InfoRow({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={clsx('flex items-start justify-between gap-4 py-2 text-[13px]', className)} title={hint}>
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 text-end font-medium break-words text-text">{value}</span>
    </div>
  )
}
