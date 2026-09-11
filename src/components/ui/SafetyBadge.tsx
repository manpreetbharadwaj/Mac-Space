import type { SafetyLevel } from '@/types'
import { clsx } from 'clsx'

const CONFIG: Record<SafetyLevel, { label: string; dot: string; classes: string }> = {
  green: {
    label: 'Safe',
    dot: 'bg-safe',
    classes: 'bg-safe-soft text-safe',
  },
  orange: {
    label: 'Review',
    dot: 'bg-review',
    classes: 'bg-review-soft text-review',
  },
  red: {
    label: 'Protected',
    dot: 'bg-protected',
    classes: 'bg-protected-soft text-protected',
  },
}

export function SafetyBadge({ level, className }: { level: SafetyLevel; className?: string }) {
  const config = CONFIG[level]
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        config.classes,
        className,
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  )
}
