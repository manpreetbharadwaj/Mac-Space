import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isTauriRuntime } from '@/services/environment'
import { getPendingNotificationRoute, onNotificationRoute } from '@/services/tauri/bridge'

/**
 * Routes a notification click may navigate to — kept in sync with
 * src-tauri/src/native_notifications.rs's own allowlist (Rust validates
 * first; this is defense-in-depth, not the only check). Never navigate to a
 * route string taken from a notification payload without going through this.
 */
const ALLOWED_ROUTES = ['/dashboard', '/cleanup', '/scan', '/schedule', '/settings', '/history'] as const
const FALLBACK_ROUTE = '/dashboard'

function toSafeRoute(route: string): string {
  return (ALLOWED_ROUTES as readonly string[]).includes(route) ? route : FALLBACK_ROUTE
}

/**
 * Implements the native-click -> pending-route -> frontend handoff:
 * - App already running: a live `notification-route` event arrives the
 *   moment the click is resolved (native side also focuses the window).
 * - App was launched by the click: there's no listener yet at launch time,
 *   so the native side stashes the route instead — this asks for it once,
 *   right after mount, and the native side clears it on read so it's never
 *   replayed on a later, unrelated startup.
 */
export function useNotificationRouteHandoff() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isTauriRuntime()) return

    let cancelled = false

    void getPendingNotificationRoute().then((route) => {
      if (!cancelled && route) navigate(toSafeRoute(route))
    })

    const unlistenPromise = onNotificationRoute((route) => {
      navigate(toSafeRoute(route))
    })

    return () => {
      cancelled = true
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [navigate])
}
