import { clsx } from 'clsx'

export interface MeterSegment {
  key: string
  label: string
  value: number
  color: string
}

/** Stacked horizontal bar with a legend — e.g. memory composition. */
export function MeterBar({
  segments,
  total,
  formatValue,
  className,
}: {
  segments: MeterSegment[]
  total: number
  formatValue: (v: number) => string
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {segments.map((s) => (
          <div key={s.key} style={{ width: `${total > 0 ? (s.value / total) * 100 : 0}%`, background: s.color }} title={`${s.label}: ${formatValue(s.value)}`} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <span key={s.key} className={clsx('inline-flex items-center gap-1.5 text-[12px] text-text-muted')}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="font-medium tabular-nums text-text">{formatValue(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
