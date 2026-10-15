import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, FolderOpen, EyeOff } from 'lucide-react'
import { SafetyBadge } from '@/components/ui/SafetyBadge'
import { useAppStore } from '@/store/useAppStore'
import { useI18n } from '@/i18n'
import { CATEGORY_ICON } from '@/lib/categoryMeta'
import type { CleanupItem } from '@/types'

export function CleanupItemRow({ item }: { item: CleanupItem }) {
  const [expanded, setExpanded] = useState(false)
  const selectedIds = useAppStore((s) => s.selectedIds)
  const toggleSelect = useAppStore((s) => s.toggleSelect)
  const excludeItem = useAppStore((s) => s.excludeItem)
  const revealInFinder = useAppStore((s) => s.revealInFinder)
  const Icon = CATEGORY_ICON[item.category]
  const selected = selectedIds.has(item.id)
  const isProtected = item.safety === 'red'
  const { t, td, fmt } = useI18n()

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={isProtected}
          aria-label={t('row.select', { name: item.name })}
          onChange={() => toggleSelect(item.id)}
          className="h-4 w-4 shrink-0 accent-accent disabled:opacity-30"
        />
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-muted">
          <Icon size={15} />
        </div>
        <button className="min-w-0 flex-1 text-start" onClick={() => setExpanded((v) => !v)}>
          <div className="flex items-center gap-2">
            <p dir="auto" className="truncate text-[13px] font-medium text-text">{td(item.name)}</p>
            <SafetyBadge level={item.safety} />
          </div>
          <p className="mt-0.5 truncate text-[12px] text-text-faint">
            {td(item.source)} · <span dir="ltr">{item.path}</span>
          </p>
        </button>
        <div className="shrink-0 text-end">
          <p className="text-[13px] font-medium text-text">{fmt.bytes(item.sizeBytes)}</p>
          <p dir="auto" className="text-[11px] text-text-faint">{td(item.lastUsedLabel)}</p>
        </div>
        <button
          onClick={() => revealInFinder(item.path)}
          title={t('row.reveal')}
          aria-label={t('row.reveal')}
          className="shrink-0 rounded-lg p-1.5 text-text-faint hover:bg-surface-2 hover:text-text"
        >
          <FolderOpen size={15} />
        </button>
        {!isProtected && (
          <button
            onClick={() => excludeItem(item.id)}
            title={t('row.exclude')}
            aria-label={t('row.exclude')}
            className="shrink-0 rounded-lg p-1.5 text-text-faint hover:bg-surface-2 hover:text-text"
          >
            <EyeOff size={15} />
          </button>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={t('row.details')}
          aria-expanded={expanded}
          className="shrink-0 rounded-lg p-1.5 text-text-faint hover:bg-surface-2 hover:text-text"
        >
          <ChevronDown size={15} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-3 px-4 pb-4 ps-[3.75rem] sm:grid-cols-2">
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-faint">{t('row.whyExists')}</p>
                <p dir="auto" className="mt-1 text-[13px] text-text-muted">{td(item.whyItExists)}</p>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-faint">{t('row.ifCleaned')}</p>
                <p dir="auto" className="mt-1 text-[13px] text-text-muted">{td(item.whatHappensIfCleaned)}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
