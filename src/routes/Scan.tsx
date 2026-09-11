import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Loader2, ScanLine, ShieldCheck, AlertTriangle } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useAppStore } from '@/store/useAppStore'
import { formatBytes } from '@/lib/format'
import { CATEGORY_ICON } from '@/lib/categoryMeta'

const STEPS = [
  'Analyzing storage',
  'Developer data',
  'Browsers',
  'Applications',
  'Downloads & files',
  'Building recommendations',
]

// Matches the phase keys emitted by src-tauri/src/commands.rs::run_full_scan,
// in the same order as STEPS above — real progress advances stepIndex by
// looking up the incoming phase here instead of a fixed timer.
const PHASE_ORDER = ['overview', 'developer', 'browsers', 'applications', 'files', 'finalizing']

const STEP_DURATION_MS = 950

export function Scan() {
  const navigate = useNavigate()
  const runScan = useAppStore((s) => s.runScan)
  const scanSession = useAppStore((s) => s.scanSession)
  const dataSource = useAppStore((s) => s.dataSource)
  const [stepIndex, setStepIndex] = useState(0)
  const [phase, setPhase] = useState<'scanning' | 'done'>('scanning')

  useEffect(() => {
    let cancelled = false

    if (dataSource === 'tauri') {
      // Real scan: advance the same fixed step list from actual backend progress
      // events instead of a simulated timer.
      runScan((update) => {
        const idx = PHASE_ORDER.indexOf(update.phase)
        if (idx >= 0 && !cancelled) setStepIndex(idx)
      }).then(() => {
        if (!cancelled) setPhase('done')
      })
      return () => {
        cancelled = true
      }
    }

    let index = 0
    const timer = setInterval(() => {
      index += 1
      if (index >= STEPS.length) {
        clearInterval(timer)
        runScan().then(() => {
          if (!cancelled) setPhase('done')
        })
        return
      }
      setStepIndex(index)
    }, STEP_DURATION_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const overallProgress = phase === 'done' ? 100 : ((stepIndex + 1) / STEPS.length) * 100

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-lg">
        <AnimatePresence mode="wait">
          {phase === 'scanning' ? (
            <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card>
                <CardBody className="py-8 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                    <ScanLine size={26} className="animate-pulse" />
                  </div>
                  <h2 className="text-[17px] font-semibold text-text">Scanning your Mac</h2>
                  <p className="mt-1 text-[13px] text-text-muted">
                    Looking for safe cleanup opportunities across your storage.
                  </p>

                  <ProgressBar value={overallProgress} className="mt-6" />

                  <div className="mt-5 space-y-2 text-left">
                    {STEPS.map((step, i) => {
                      const state = i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'pending'
                      return (
                        <div
                          key={step}
                          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                            state === 'active' ? 'bg-surface-2 text-text' : 'text-text-muted'
                          }`}
                        >
                          {state === 'done' && <Check size={15} className="text-safe" />}
                          {state === 'active' && <Loader2 size={15} className="animate-spin text-accent" />}
                          {state === 'pending' && <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />}
                          {step}
                        </div>
                      )
                    })}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <CardBody className="py-8 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-safe-soft text-safe">
                    <ShieldCheck size={26} />
                  </div>
                  <h2 className="text-[17px] font-semibold text-text">Scan complete</h2>
                  <p className="mt-1 text-[13px] text-text-muted">Here's what we found.</p>

                  <p className="mt-5 text-3xl font-semibold text-text">
                    {formatBytes((scanSession?.safeBytes ?? 0) + (scanSession?.reviewBytes ?? 0))}
                  </p>
                  <p className="text-[13px] text-text-muted">total reclaimable space found</p>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-safe-soft p-3 text-left">
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-safe">
                        <ShieldCheck size={13} />
                        Safe
                      </div>
                      <p className="mt-1 text-[15px] font-semibold text-text">{formatBytes(scanSession?.safeBytes ?? 0)}</p>
                    </div>
                    <div className="rounded-xl bg-review-soft p-3 text-left">
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-review">
                        <AlertTriangle size={13} />
                        Review
                      </div>
                      <p className="mt-1 text-[15px] font-semibold text-text">{formatBytes(scanSession?.reviewBytes ?? 0)}</p>
                    </div>
                  </div>

                  {scanSession?.biggestCategory && (
                    <div className="mt-4 flex items-center justify-center gap-2 text-[12px] text-text-muted">
                      Biggest opportunity:
                      {(() => {
                        const Icon = CATEGORY_ICON[scanSession.biggestCategory]
                        return <Icon size={13} />
                      })()}
                      <span className="capitalize text-text">{scanSession.biggestCategory}</span>
                    </div>
                  )}

                  <Button variant="primary" className="mt-6 w-full" onClick={() => navigate('/cleanup')}>
                    Review Cleanup
                  </Button>
                </CardBody>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
