import { clsx } from 'clsx'

export type StatusTone = 'good' | 'fair' | 'attention' | 'neutral'

const TONE_CLASS: Record<StatusTone, string> = {
  good: 'bg-safe-soft text-safe',
  fair: 'bg-review-soft text-review',
  attention: 'bg-protected-soft text-protected',
  neutral: 'bg-surface-2 text-text-muted',
}

export function StatusChip({ tone, label, className }: { tone: StatusTone; label: string; className?: string }) {
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium', TONE_CLASS[tone], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  )
}
