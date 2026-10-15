import { clsx } from 'clsx'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45',
            size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]',
            value === o.value ? 'bg-surface text-text shadow-sm dark:shadow-none' : 'text-text-muted hover:text-text',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="text-[11px] tabular-nums text-text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
