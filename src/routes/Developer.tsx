import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Code2, Box, Smartphone, Package, Container, FileCode, ChevronDown, HelpCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { CleanupItemRow } from '@/components/cleanup/CleanupItemRow'
import { useAppStore } from '@/store/useAppStore'
import { useI18n, type MessageKey } from '@/i18n'
import type { DeveloperTool } from '@/types'

/** Tool names are product names (kept as-is); "why safe" copy is translated. */
const TOOL_META: Record<DeveloperTool, { label: string | MessageKey; translateLabel: boolean; icon: typeof Code2; whySafe: MessageKey }> = {
  xcode: { label: 'Xcode', translateLabel: false, icon: Code2, whySafe: 'dev.why.xcode' },
  node: { label: 'Node.js', translateLabel: false, icon: Box, whySafe: 'dev.why.node' },
  android: { label: 'dev.tool.android', translateLabel: true, icon: Smartphone, whySafe: 'dev.why.android' },
  cocoapods: { label: 'CocoaPods / Ruby', translateLabel: false, icon: Package, whySafe: 'dev.why.cocoapods' },
  docker: { label: 'Docker', translateLabel: false, icon: Container, whySafe: 'dev.why.docker' },
  general: { label: 'dev.tool.general', translateLabel: true, icon: FileCode, whySafe: 'dev.why.general' },
}

const TOOL_ORDER: DeveloperTool[] = ['xcode', 'node', 'android', 'cocoapods', 'docker', 'general']

function ToolSection({ tool }: { tool: DeveloperTool }) {
  const meta = TOOL_META[tool]
  const { t, tp, fmt } = useI18n()
  const formatBytes = (b: number) => fmt.bytes(b)
  const label = meta.translateLabel ? t(meta.label as MessageKey) : meta.label
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const items = useMemo(() => cleanupItems.filter((i) => i.tool === tool && !i.excluded), [cleanupItems, tool])
  const [open, setOpen] = useState(tool === 'xcode')
  const [whyOpen, setWhyOpen] = useState(false)

  const totalBytes = items.reduce((s, i) => s + i.sizeBytes, 0)
  const safeBytes = items.filter((i) => i.safety === 'green').reduce((s, i) => s + i.sizeBytes, 0)
  const reviewBytes = items.filter((i) => i.safety === 'orange').reduce((s, i) => s + i.sizeBytes, 0)

  if (tool === 'docker') {
    return (
      <Card className="opacity-70">
        <CardBody className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-text-faint">
              <Container size={17} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-text">{label}</p>
              <p className="text-[12px] text-text-faint">{t('dev.notConnected')}</p>
            </div>
          </div>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-text-faint">{t('dev.comingLater')}</span>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <meta.icon size={17} />
          </div>
          <div className="text-start">
            <p className="text-[13px] font-medium text-text">{label}</p>
            <p className="text-[12px] text-text-faint">{tp('detected', items.length)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden text-end sm:block">
            <p className="text-[13px] font-semibold text-text">{formatBytes(totalBytes)}</p>
            <p className="text-[11px] text-text-faint">
              <span className="text-safe">{t('dev.safeAmount', { size: formatBytes(safeBytes) })}</span> ·{' '}
              <span className="text-review">{t('dev.reviewAmount', { size: formatBytes(reviewBytes) })}</span>
            </p>
          </div>
          <ChevronDown size={16} className={open ? 'rotate-180 text-text-muted transition-transform' : 'text-text-muted transition-transform'} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="border-t border-border px-5 py-3">
              <button
                onClick={() => setWhyOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[12px] font-medium text-accent"
              >
                <HelpCircle size={13} />
                {t('dev.whySafe')}
              </button>
              {whyOpen && <p className="mt-2 text-[12px] leading-relaxed text-text-muted">{t(meta.whySafe)}</p>}
            </div>
            <div>
              {items.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-text-faint">{t('dev.noItems')}</p>
              ) : (
                items.map((item) => <CleanupItemRow key={item.id} item={item} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

export function Developer() {
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const selectIds = useAppStore((s) => s.selectIds)
  const { t, fmt } = useI18n()

  const developerItems = useMemo(
    () => cleanupItems.filter((i) => i.category === 'developer' && !i.excluded),
    [cleanupItems],
  )
  const totalBytes = developerItems.reduce((s, i) => s + i.sizeBytes, 0)

  function selectAllSafe() {
    selectIds(developerItems.filter((i) => i.safety === 'green').map((i) => i.id))
  }

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        title={t('dev.title')}
        description={t('dev.description')}
        actions={
          <Button variant="secondary" onClick={selectAllSafe}>
            {t('dev.selectAllSafe')}
          </Button>
        }
      />

      <Card className="border-dashed">
        <CardBody className="flex items-center justify-between">
          <p className="text-[13px] text-text-muted">{t('dev.totalDetected')}</p>
          <p className="text-lg font-semibold text-text">{fmt.bytes(totalBytes)}</p>
        </CardBody>
      </Card>

      <div className="space-y-3">
        {TOOL_ORDER.map((tool) => (
          <ToolSection key={tool} tool={tool} />
        ))}
      </div>
    </div>
  )
}
