import { motion, useReducedMotion } from 'framer-motion'
import { clsx } from 'clsx'

type Tone = 'default' | 'danger'

/**
 * The one boolean on/off control for the whole app — every Settings and
 * Schedule toggle should render through this rather than a one-off
 * `<button>` with hand-rolled track/thumb classes, so they can never drift
 * into visually inconsistent switches. Purely presentational: callers own
 * `checked`/`onChange` exactly as before.
 *
 * `tone="danger"` is for settings that carry real risk (permanent deletion)
 * — its ON state reads as a restrained warning rather than a copy of the
 * everyday accent treatment, without turning the whole control into an
 * alarm. Everything else should use the default tone.
 */
export function PremiumSwitch({
  checked,
  onChange,
  label,
  tone = 'default',
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  /** Accessible name — the visible setting title this switch controls (e.g. "Notifications"). Not rendered, only exposed to assistive tech. */
  label: string
  tone?: Tone
  disabled?: boolean
}) {
  const reducedMotion = useReducedMotion() ?? false
  const isDanger = tone === 'danger' && checked

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-[180ms] ease-out',
        // The inset track shadow is a Tailwind shadow utility (not an inline
        // style) specifically so it composes with focus-visible:ring-* via
        // Tailwind's shared --tw-shadow/--tw-ring-shadow box-shadow
        // variables — an inline `style={{ boxShadow }}` would silently win
        // the cascade over the ring classes and hide the focus ring
        // entirely (caught this live: `:focus-visible` matched but no ring
        // ever rendered until this was fixed).
        checked ? 'shadow-[inset_0_1px_1.5px_0_rgb(0_0_0_/_0.14)]' : 'shadow-[inset_0_1px_1.5px_0_rgb(0_0_0_/_0.05)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:cursor-not-allowed disabled:opacity-45',
        !disabled && 'active:scale-[0.96]',
        checked
          ? isDanger
            ? 'border-protected/30 bg-protected/85 hover:bg-protected/95'
            : 'border-accent/30 bg-accent hover:brightness-110'
          : 'border-border-strong bg-surface-2 hover:bg-surface-hover',
      )}
    >
      <motion.span
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white"
        style={{ boxShadow: '0 1px 2.5px 0 rgb(0 0 0 / 0.35), 0 0 0 0.5px rgb(0 0 0 / 0.06)' }}
        animate={{ x: checked ? 16 : 0 }}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 620, damping: 34 }}
      />
    </button>
  )
}
