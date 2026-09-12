import { useEffect } from 'react'
import { useUpdateStore } from '@/store/useUpdateStore'

/**
 * Wires the update/remote-config lifecycle: an initial check on mount
 * (app startup), plus a re-check when the window regains focus if the
 * cache interval has elapsed (see FOCUS_RECHECK_INTERVAL_MS in
 * useUpdateStore.ts). Never polls on a timer — only startup, focus-regain,
 * and the manual "Check for Updates" button in Settings trigger a check.
 */
export function useUpdateLifecycle() {
  const initialize = useUpdateStore((s) => s.initialize)
  const maybeCheckOnFocus = useUpdateStore((s) => s.maybeCheckOnFocus)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return
      maybeCheckOnFocus()
    }
    window.addEventListener('focus', handleVisible)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      window.removeEventListener('focus', handleVisible)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [maybeCheckOnFocus])
}
