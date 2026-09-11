import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-faint">
        <Icon size={22} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="mx-auto max-w-sm text-[13px] text-text-muted">{description}</p>
      </div>
      {action}
    </div>
  )
}
