import { clsx } from 'clsx'

export function ProgressBar({
  value,
  className,
  trackClassName,
  barClassName,
}: {
  value: number
  className?: string
  trackClassName?: string
  barClassName?: string
}) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-surface-2', trackClassName, className)}>
      <div
        className={clsx('h-full rounded-full bg-accent transition-[width] duration-500 ease-out', barClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function SegmentedBar({
  segments,
  className,
}: {
  segments: { value: number; color: string; label?: string }[]
  className?: string
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1
  return (
    <div className={clsx('flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      {segments.map((segment, i) => (
        <div
          key={i}
          title={segment.label}
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }}
        />
      ))}
    </div>
  )
}
