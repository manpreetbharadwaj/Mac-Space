import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2, PartyPopper, ShieldAlert, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAppStore, selectTotalBytes, type LastCleanupResult } from '@/store/useAppStore'
import { useI18n } from '@/i18n'

/** Categories that hold the user's own files rather than regenerable tool/cache data. */
const USER_FILE_CATEGORIES = new Set(['downloads', 'documents', 'media'])

export function CleanupActionBar() {
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const selectedIds = useAppStore((s) => s.selectedIds)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const cleanSelected = useAppStore((s) => s.cleanSelected)
  const cleaning = useAppStore((s) => s.cleaning)
  const settings = useAppStore((s) => s.settings)
  const diskSummary = useAppStore((s) => s.diskSummary)
  const dataSource = useAppStore((s) => s.dataSource)
  const { t, tp, td, fmt } = useI18n()
  const formatBytes = (b: number) => fmt.bytes(b)

  const [reviewOpen, setReviewOpen] = useState(false)
  const [acknowledgedOrange, setAcknowledgedOrange] = useState(false)
  const [permanentConfirmed, setPermanentConfirmed] = useState(false)
  const [wantsPermanent, setWantsPermanent] = useState(false)
  const [progressLabel, setProgressLabel] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<{
    before: number
    after: number
    result: LastCleanupResult
  } | null>(null)

  if (selectedIds.size === 0 && !reviewOpen) return null

  const selectedItems = cleanupItems.filter((i) => selectedIds.has(i.id))
  const selectedBytes = selectTotalBytes(cleanupItems, selectedIds)
  const selectedGreen = selectedItems.filter((i) => i.safety === 'green')
  const selectedOrange = selectedItems.filter((i) => i.safety === 'orange')
  const selectedUserFiles = selectedItems.filter((i) => USER_FILE_CATEGORIES.has(i.category))
  const needsAck = selectedOrange.length > 0
  const canConfirm = !needsAck || acknowledgedOrange
  const canConfirmPermanent = !wantsPermanent || permanentConfirmed
  // Real permanent deletion isn't implemented yet — never offer it outside mock mode,
  // regardless of the Settings toggle, so the UI never implies something it won't do.
  const permanentOptionAvailable = dataSource === 'mock' && settings?.permanentDeleteEnabled

  function openReview() {
    setAcknowledgedOrange(false)
    setWantsPermanent(false)
    setPermanentConfirmed(false)
    setProgressLabel(null)
    setSuccessResult(null)
    setReviewOpen(true)
  }

  async function confirmClean() {
    const before = diskSummary?.usedBytes ?? 0
    await cleanSelected(wantsPermanent ? 'permanent' : 'trash', (update) => setProgressLabel(update.label))
    const store = useAppStore.getState()
    const after = store.diskSummary?.usedBytes ?? before
    setProgressLabel(null)
    if (store.lastCleanupResult) {
      setSuccessResult({ before, after, result: store.lastCleanupResult })
    }
  }

  return (
    <>
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5"
          >
            <div className="flex w-full max-w-xl items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-3.5 shadow-xl">
              <div>
                <p className="text-[13px] font-medium text-text">{tp('selected', selectedIds.size)}</p>
                <p className="text-[12px] text-text-muted">{t('bar.willReclaim', { size: formatBytes(selectedBytes) })}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={clearSelection}>
                  {t('clean.clear')}
                </Button>
                <Button variant="primary" onClick={openReview}>
                  {t('bar.reviewClean')}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={reviewOpen}
        onClose={() => !cleaning && setReviewOpen(false)}
        title={successResult ? t('bar.titleComplete') : t('bar.titleReview')}
      >
        {successResult ? (
          <div className="py-2 text-center">
            <div
              className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${
                successResult.result.failureCount > 0 ? 'bg-review-soft text-review' : 'bg-safe-soft text-safe'
              }`}
            >
              {successResult.result.failureCount > 0 ? <TriangleAlert size={22} /> : <PartyPopper size={22} />}
            </div>

            {dataSource === 'tauri' ? (
              <>
                <p className="text-lg font-semibold text-text">{t('bar.movedToTrash', { size: formatBytes(successResult.result.actualBytes) })}</p>
                <p className="text-[13px] text-text-muted">
                  {t('bar.succeeded', {
                    ok: fmt.number(successResult.result.successCount),
                    total: fmt.number(successResult.result.successCount + successResult.result.failureCount),
                  })}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-start">
                  <div className="rounded-xl bg-surface-2 p-3">
                    <p className="text-[11px] text-text-faint">{t('bar.labelMoved')}</p>
                    <p className="text-[14px] font-medium text-text">{formatBytes(successResult.result.actualBytes)}</p>
                  </div>
                  <div className="rounded-xl bg-surface-2 p-3">
                    <p className="text-[11px] text-text-faint">{t('bar.freedNow')}</p>
                    <p className="text-[14px] font-medium text-text">{formatBytes(successResult.result.freedOnDiskBytes ?? 0)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-text-faint">
                  {t('bar.trashNote')}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-text">{t('bar.reclaimed', { size: formatBytes(successResult.result.actualBytes) })}</p>
                <p className="text-[13px] text-text-muted">{tp('cleaned', successResult.result.itemCount)}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-start">
                  <div className="rounded-xl bg-surface-2 p-3">
                    <p className="text-[11px] text-text-faint">{t('bar.before')}</p>
                    <p className="text-[14px] font-medium text-text">{formatBytes(successResult.before)}</p>
                  </div>
                  <div className="rounded-xl bg-surface-2 p-3">
                    <p className="text-[11px] text-text-faint">{t('bar.after')}</p>
                    <p className="text-[14px] font-medium text-text">{formatBytes(successResult.after)}</p>
                  </div>
                </div>
              </>
            )}

            {successResult.result.failures.length > 0 && (
              <div className="mt-4 rounded-lg bg-review-soft p-3 text-start">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-review">
                  <AlertTriangle size={13} />
                  {tp('notMoved', successResult.result.failures.length)}
                </p>
                <ul className="space-y-1">
                  {successResult.result.failures.map((failure) => (
                    <li key={failure.path} className="text-[12px] text-text">
                      <span className="font-medium">{td(failure.name)}</span>
                      <span className="text-text-muted"> — {td(failure.reason)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-text-faint">
                  {t('bar.stillSelected')}
                </p>
              </div>
            )}

            <Button variant="primary" className="mt-5 w-full" onClick={() => setReviewOpen(false)}>
              {t('bar.done')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {dataSource === 'tauri' && (
              <div className="flex items-start gap-2 rounded-lg bg-accent-soft p-3 text-[12px] text-text">
                <Trash2 size={14} className="mt-0.5 shrink-0 text-accent" />
                <span>{t('bar.trashInfo')}</span>
              </div>
            )}

            {dataSource === 'tauri' && selectedUserFiles.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-review-soft p-3 text-[12px] text-text">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-review" />
                <span>{t('bar.userFiles', { count: fmt.number(selectedUserFiles.length) })}</span>
              </div>
            )}

            {selectedGreen.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-safe">
                  <ShieldCheck size={13} />
                  {t('bar.group', {
                    label: t('safety.green'),
                    items: tp('items', selectedGreen.length),
                    size: formatBytes(selectedGreen.reduce((s, i) => s + i.sizeBytes, 0)),
                  })}
                </div>
                <ul className="space-y-1">
                  {selectedGreen.map((item) => (
                    <li key={item.id} className="flex justify-between text-[13px] text-text-muted">
                      <span dir="auto" className="truncate pe-2">{td(item.name)}</span>
                      <span className="shrink-0 text-text">{formatBytes(item.sizeBytes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selectedOrange.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-review">
                  <AlertTriangle size={13} />
                  {t('bar.group', {
                    label: t('safety.orange'),
                    items: tp('items', selectedOrange.length),
                    size: formatBytes(selectedOrange.reduce((s, i) => s + i.sizeBytes, 0)),
                  })}
                </div>
                <ul className="mb-2 space-y-1">
                  {selectedOrange.map((item) => (
                    <li key={item.id} className="flex justify-between text-[13px] text-text-muted">
                      <span dir="auto" className="truncate pe-2">{td(item.name)}</span>
                      <span className="shrink-0 text-text">{formatBytes(item.sizeBytes)}</span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-start gap-2 rounded-lg bg-review-soft p-3 text-[12px] text-text">
                  <input
                    type="checkbox"
                    checked={acknowledgedOrange}
                    onChange={(e) => setAcknowledgedOrange(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-review"
                  />
                  {t('bar.ackOrange')}
                </label>
              </div>
            )}

            {permanentOptionAvailable && (
              <div className="rounded-lg border border-border p-3">
                <label className="flex items-center gap-2 text-[12px] font-medium text-text">
                  <input
                    type="checkbox"
                    checked={wantsPermanent}
                    onChange={(e) => setWantsPermanent(e.target.checked)}
                    className="h-3.5 w-3.5 accent-protected"
                  />
                  {t('bar.deletePermanently')}
                </label>
                {wantsPermanent && (
                  <label className="mt-2 flex items-start gap-2 rounded-lg bg-protected-soft p-2.5 text-[12px] text-text">
                    <input
                      type="checkbox"
                      checked={permanentConfirmed}
                      onChange={(e) => setPermanentConfirmed(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-protected"
                    />
                    <span className="flex items-center gap-1">
                      <ShieldAlert size={13} className="shrink-0" />
                      {t('bar.cannotUndo')}
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-surface-2 p-3">
              <span className="text-[13px] text-text-muted">{t('bar.total')}</span>
              <span className="text-[15px] font-semibold text-text">{formatBytes(selectedBytes)}</span>
            </div>

            {cleaning && progressLabel && <p className="text-center text-[12px] text-text-muted">{td(progressLabel)}</p>}

            <Button
              variant="primary"
              className="w-full"
              disabled={!canConfirm || !canConfirmPermanent || cleaning}
              onClick={confirmClean}
            >
              {cleaning ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t('bar.cleaning')}
                </>
              ) : (
                tp('cleanN', selectedIds.size)
              )}
            </Button>
          </div>
        )}
      </Modal>
    </>
  )
}
