import { useId } from 'react'

export interface ChartPoint {
  t: number
  v: number | null
}

/**
 * Minimal time-series area chart (0–100%). Plain SVG with no animation or
 * chart library: it redraws every sample, so it has to be cheap. Gaps in
 * the data (null values, or sampling paused while the window was hidden)
 * break the line instead of being interpolated across.
 */
export function UsageChart({
  points,
  windowMs,
  color,
  label,
  emptyLabel,
  height = 84,
}: {
  points: ChartPoint[]
  windowMs: number
  color: string
  label: string
  emptyLabel: string
  height?: number
}) {
  const gradientId = useId()
  const W = 300
  const H = 100
  // The newest sample anchors the right edge; with no samples there is nothing to place.
  const now = points.length ? points[points.length - 1].t : windowMs
  const start = now - windowMs
  const visible = points.filter((p) => p.t >= start)
  const x = (t: number) => ((t - start) / windowMs) * W
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H

  // Split into contiguous runs: a null value or a gap of > 3× the typical
  // spacing (e.g. polling paused) starts a new segment.
  const spacing =
    visible.length > 2 ? (visible[visible.length - 1].t - visible[0].t) / (visible.length - 1) : Number.POSITIVE_INFINITY
  const segments: { t: number; v: number }[][] = []
  let current: { t: number; v: number }[] = []
  let prevT: number | null = null
  for (const p of visible) {
    const gap = prevT !== null && p.t - prevT > spacing * 3
    if (p.v === null || gap) {
      if (current.length) segments.push(current)
      current = []
    }
    if (p.v !== null) current.push({ t: p.t, v: p.v })
    prevT = p.t
  }
  if (current.length) segments.push(current)
  const drawable = segments.filter((s) => s.length >= 2)

  return (
    <div dir="ltr" className="relative w-full" style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((g) => (
          <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="var(--color-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
        ))}
        {drawable.map((seg, i) => {
          const line = seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ')
          const area = `${line} L${x(seg[seg.length - 1].t).toFixed(2)},${H} L${x(seg[0].t).toFixed(2)},${H} Z`
          return (
            <g key={i}>
              <path d={area} fill={`url(#${gradientId})`} />
              <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>
      {drawable.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-text-faint">{emptyLabel}</div>
      )}
    </div>
  )
}
