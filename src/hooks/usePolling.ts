import { useEffect, useRef } from 'react'

/**
 * Calls `fn` immediately and then every `intervalMs`, but only while the
 * document is visible — a hidden or minimized window stops polling
 * entirely (so it costs nothing) and catches up with one call when it
 * becomes visible again. Pass `intervalMs: null` to pause.
 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number | null) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    if (intervalMs === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      if (document.visibilityState === 'visible') {
        try {
          await fnRef.current()
        } catch {
          // Callers surface their own errors; a failed tick must not stop polling.
        }
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer)
        void tick()
      }
    }

    void tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
}
