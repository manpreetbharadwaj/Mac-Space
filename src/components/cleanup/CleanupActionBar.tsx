import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2, PartyPopper, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAppStore, selectTotalBytes } from '@/store/useAppStore'
import { formatBytes } from '@/lib/format'

export function CleanupActionBar() {
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const selectedIds = useAppStore((s) => s.selectedIds)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const cleanSelected = useAppStore((s) => s.cleanSelected)
  const cleaning = useAppStore((s) => s.cleaning)
  const settings = useAppStore((s) => s.settings)
  const diskSummary = useAppStore((s) => s.diskSummary)

  const [reviewOpen, setReviewOpen] = useState(false)
  const [acknowledgedOrange, setAcknowledgedOrange] = useState(false)
  const [permanentConfirmed, setPermanentConfirmed] = useState(false)
  const [wantsPermanent, setWantsPermanent] = useState(false)
  const [successResult, setSuccessResult] = useState<{
    actualBytes: number
    itemCount: number
    before: number
    after: number
  } | null>(null)

  if (selectedIds.size === 0 && !reviewOpen) return null

  const selectedItems = cleanupItems.filter((i) => selectedIds.has(i.id))
  const selectedBytes = selectTotalBytes(cleanupItems, selectedIds)
  const selectedGreen = selectedItems.filter((i) => i.safety === 'green')
  const selectedOrange = selectedItems.filter((i) => i.safety === 'orange')
  const needsAck = selectedOrange.length > 0
  const canConfirm = !needsAck || acknowledgedOrange
  const canConfirmPermanent = !wantsPermanent || permanentConfirmed

  function openReview() {
    setAcknowledgedOrange(false)
    setWantsPermanent(false)
    setPermanentConfirmed(false)
    setSuccessResult(null)
    setReviewOpen(true)
  }

  async function confirmClean() {
    const before = diskSummary?.usedBytes ?? 0
    await cleanSelected(wantsPermanent ? 'permanent' : 'trash')
    const store = useAppStore.getState()
    const after = store.diskSummary?.usedBytes ?? before
    setSuccessResult({
      actualBytes: store.lastCleanupResult?.actualBytes ?? 0,
      itemCount: store.lastCleanupResult?.itemCount ?? 0,
      before,
      after,
    })
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
                <p className="text-[13px] font-medium text-text">
                  {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} selected
                </p>
                <p className="text-[12px] text-text-muted">{formatBytes(selectedBytes)} will be reclaimed</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={clearSelection}>
                  Clear
                </Button>
                <Button variant="primary" onClick={openReview}>
                  Review & Clean
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={reviewOpen}
        onClose={() => !cleaning && setReviewOpen(false)}
        title={successResult ? 'Cleanup complete' : 'Review cleanup'}
      >
        {successResult ? (
          <div className="py-2 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-safe-soft text-safe">
              <PartyPopper size={22} />
            </div>
            <p className="text-lg font-semibold text-text">{formatBytes(successResult.actualBytes)} reclaimed</p>
            <p className="text-[13px] text-text-muted">
              {successResult.itemCount} item{successResult.itemCount === 1 ? '' : 's'} cleaned
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-xl bg-surface-2 p-3">
                <p className="text-[11px] text-text-faint">Before</p>
                <p className="text-[14px] font-medium text-text">{formatBytes(successResult.before)}</p>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <p className="text-[11px] text-text-faint">After</p>
                <p className="text-[14px] font-medium text-text">{formatBytes(successResult.after)}</p>
              </div>
            </div>
            <Button variant="primary" className="mt-5 w-full" onClick={() => setReviewOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {selectedGreen.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-safe">
                  <ShieldCheck size={13} />
                  Safe · {selectedGreen.length} items · {formatBytes(selectedGreen.reduce((s, i) => s + i.sizeBytes, 0))}
                </div>
                <ul className="space-y-1">
                  {selectedGreen.map((item) => (
                    <li key={item.id} className="flex justify-between text-[13px] text-text-muted">
                      <span className="truncate pr-2">{item.name}</span>
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
                  Review · {selectedOrange.length} items · {formatBytes(selectedOrange.reduce((s, i) => s + i.sizeBytes, 0))}
                </div>
                <ul className="mb-2 space-y-1">
                  {selectedOrange.map((item) => (
                    <li key={item.id} className="flex justify-between text-[13px] text-text-muted">
                      <span className="truncate pr-2">{item.name}</span>
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
                  I understand these items may trigger re-downloads, rebuilds, or sign-outs.
                </label>
              </div>
            )}

            {settings?.permanentDeleteEnabled && (
              <div className="rounded-lg border border-border p-3">
                <label className="flex items-center gap-2 text-[12px] font-medium text-text">
                  <input
                    type="checkbox"
                    checked={wantsPermanent}
                    onChange={(e) => setWantsPermanent(e.target.checked)}
                    className="h-3.5 w-3.5 accent-protected"
                  />
                  Delete permanently instead of moving to Trash
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
                      I understand this cannot be undone.
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-surface-2 p-3">
              <span className="text-[13px] text-text-muted">Total to reclaim</span>
              <span className="text-[15px] font-semibold text-text">{formatBytes(selectedBytes)}</span>
            </div>

            <Button
              variant="primary"
              className="w-full"
              disabled={!canConfirm || !canConfirmPermanent || cleaning}
              onClick={confirmClean}
            >
              {cleaning ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Cleaning…
                </>
              ) : (
                `Clean ${selectedIds.size} item${selectedIds.size === 1 ? '' : 's'}`
              )}
            </Button>
          </div>
        )}
      </Modal>
    </>
  )
}
