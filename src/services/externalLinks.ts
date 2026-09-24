import { isTauriRuntime } from '@/services/environment'
import { openExternalUrl } from '@/services/tauri/bridge'

/**
 * The Tauri WebView cannot follow an external <a href> on its own (the click
 * silently does nothing), so inside the desktop shell every https link is
 * routed through the validated native opener instead. In the plain browser
 * prototype, normal link behavior is left untouched.
 */
export function installExternalLinkHandler(): void {
  if (!isTauriRuntime()) return

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return

    let url: URL
    try {
      url = new URL(anchor.href)
    } catch {
      return
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
    if (url.origin === window.location.origin) return

    event.preventDefault()
    openExternalUrl(url.toString()).catch((error) => {
      console.error('Could not open link in the default browser:', error)
    })
  })
}
