import type { ButtonHTMLAttributes } from 'react'
import { clsx } from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-accent text-accent-contrast hover:brightness-110 shadow-sm',
  secondary:
    'bg-surface-2 text-text hover:bg-surface-hover border border-border',
  ghost: 'text-text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-protected text-white hover:brightness-110 shadow-sm',
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  )
}
