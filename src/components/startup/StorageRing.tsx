import { useMemo } from 'react'
import { motion } from 'framer-motion'
import type { StorageCategory } from '@/types'

interface Arc {
  key: string
  opacity: number
  length: number
  offset: number
}

const GAP = 0.018
/** Real segments are shades of one accent hue (opacity only) rather than
 * the Dashboard's full per-category palette — a multi-hue "pie chart" reads
 * as a colorful SaaS trope on a launch screen; one restrained hue with the
 * proportions still genuinely encoded in each arc's length keeps this calm
 * without inventing a second, competing color language for the same data. */
const REAL_OPACITY_FLOOR = 0.32

/** Splits the ring into arcs proportional to `weights`, with a small fixed gap between each — used for both the abstract (equal-weight) and real (data-weighted) states so the two only ever differ in weight/opacity, not layout logic. */
function computeArcs(entries: { key: string; opacity: number; weight: number }[]): Arc[] {
  const totalGap = GAP * entries.length
  const usable = Math.max(0, 1 - totalGap)
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0) || 1
  let cursor = 0
  return entries.map((entry) => {
    const length = (entry.weight / totalWeight) * usable
    const offset = cursor
    cursor += length + GAP
    return { key: entry.key, opacity: entry.opacity, length, offset }
  })
}

const ABSTRACT_SLOTS = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, opacity: 1, weight: 1 }))

/**
 * The storage ring: an abstract, equal-weight 5-slot ring while data is
 * still loading (never fabricated values), which smoothly reflows into the
 * real category proportions the instant `categories` has real data —
 * `revealed` gates which one is shown. `size` in px; everything else scales
 * off the 100x100 viewBox.
 */
export function StorageRing({
  categories,
  revealed,
  scanning,
  reducedMotion,
  size = 176,
}: {
  categories: StorageCategory[]
  revealed: boolean
  scanning: boolean
  reducedMotion: boolean
  size?: number
}) {
  const realArcs = useMemo(() => {
    const withUsage = categories
      .filter((c) => c.usedBytes > 0)
      .slice()
      .sort((a, b) => b.usedBytes - a.usedBytes)
      // Capped at 6 — beyond that, extra segments would be slivers too thin
      // to read as anything but visual noise; the smallest categories are
      // exactly the ones a glance at a ring shouldn't need to resolve.
      .slice(0, 6)
    if (withUsage.length === 0) return null
    return computeArcs(
      withUsage.map((c, i) => ({
        key: c.id,
        weight: c.usedBytes,
        opacity: withUsage.length === 1 ? 1 : 1 - (i / (withUsage.length - 1)) * (1 - REAL_OPACITY_FLOOR),
      })),
    )
  }, [categories])

  const abstractArcs = useMemo(() => computeArcs(ABSTRACT_SLOTS), [])
  const arcs = revealed && realArcs ? realArcs : abstractArcs
  const radius = 42

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Restrained glow — one soft, tightly-contained circle behind the
          badge, not a screen-filling spotlight. */}
      <div
        className="absolute inset-[28%] rounded-full opacity-[0.22] blur-xl"
        style={{ background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)' }}
      />

      <svg viewBox="0 0 100 100" className="relative h-full w-full">
        <g transform="rotate(-90 50 50)">
          {/* Faint static track beneath the segments. */}
          <circle cx={50} cy={50} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={3} opacity={0.7} />

          {arcs.map((arc) => (
            <motion.circle
              key={arc.key}
              cx={50}
              cy={50}
              r={radius}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={4}
              strokeLinecap="round"
              initial={{ pathLength: 0, pathOffset: arc.offset, opacity: 0 }}
              animate={{
                pathLength: arc.length,
                pathOffset: arc.offset,
                opacity: revealed && realArcs ? arc.opacity : 0.38,
              }}
              transition={{ duration: reducedMotion ? 0.2 : 0.8, ease: [0.22, 1, 0.36, 1] }}
              style={{ pathSpacing: 1 }}
            />
          ))}

          {/* Thin inner ring — pure decoration, gives the mark depth without another data encoding. */}
          <circle cx={50} cy={50} r={radius - 11} fill="none" stroke="var(--color-border)" strokeWidth={1} opacity={0.4} />
        </g>
      </svg>

      {/* Scanning sweep: a slow, faint rotating wedge masked to the ring's footprint — a quiet "still working" cue, not a spinner. Skipped entirely under reduced motion rather than just slowed down. */}
      {scanning && !reducedMotion && (
        <motion.div
          className="absolute inset-0"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0%, var(--color-accent) 5%, transparent 16%)',
            WebkitMaskImage: 'radial-gradient(circle, transparent 63%, black 64%, black 71%, transparent 72%)',
            maskImage: 'radial-gradient(circle, transparent 63%, black 64%, black 71%, transparent 72%)',
            opacity: 0.55,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'linear' }}
        />
      )}
    </div>
  )
}
