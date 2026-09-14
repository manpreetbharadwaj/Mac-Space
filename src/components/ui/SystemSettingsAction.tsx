import type { LucideIcon } from 'lucide-react'
import { Bell, ArrowUpRight } from 'lucide-react'
import { clsx } from 'clsx'

/**
 * A secondary action that hands off to a real macOS system panel (System
 * Settings, in this app's case). Deliberately distinct from `<Button>`'s
 * `ghost`/`secondary` variants — those read as in-app actions, and this one
 * needs to read as "this leaves the app and opens something native," via
 * the leading system icon and trailing external-link arrow.
 *
 * Used by both Settings and Schedule's notification permission rows so the
 * two never drift into two different-looking buttons for the same action.
 */
export function SystemSettingsAction({
  label,
  onClick,
  icon: Icon = Bell,
  className,
}: {
  label: string
  onClick: () => void
  icon?: LucideIcon
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5',
        'text-[12px] font-medium text-text-muted shadow-sm dark:shadow-none',
        'transition-colors duration-[160ms] ease-out hover:border-border-strong hover:bg-surface-hover hover:text-text',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'active:scale-[0.97]',
        className,
      )}
    >
      <Icon size={13} className="shrink-0 text-text-faint transition-colors duration-[160ms] group-hover:text-text-muted" />
      <span>{label}</span>
      <ArrowUpRight
        size={12}
        className="shrink-0 text-text-faint transition-[transform,color] duration-[160ms] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-text-muted"
      />
    </button>
  )
}
