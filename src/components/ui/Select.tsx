import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

/** Native <select> (so it gets the real macOS menu), styled to match the app's controls. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  /** Accessible name. */
  label: string
  className?: string
  disabled?: boolean
}) {
  return (
    <div className={clsx('relative inline-flex shrink-0', className)}>
      <select
        aria-label={label}
        disabled={disabled}
        value={String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.target.value)
          if (hit) onChange(hit.value)
        }}
        className="h-8 w-full appearance-none rounded-lg border border-border bg-surface ps-3 pe-8 text-[12px] font-medium text-text shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-50 dark:shadow-none"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
    </div>
  )
}
