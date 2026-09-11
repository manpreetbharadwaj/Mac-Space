import { useEffect, useRef } from 'react'
import { Lock, KeyRound, Bookmark, Puzzle, Type } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { CleanupItemRow } from '@/components/cleanup/CleanupItemRow'
import { useAppStore } from '@/store/useAppStore'
import { formatBytes } from '@/lib/format'

function ProtectedChip({ icon: Icon, label, count }: { icon: typeof Lock; label: string; count: number | null }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
      <Icon size={14} className="text-text-faint" />
      <div>
        <p className="text-[12px] font-medium text-text">{count === null ? 'Not scanned' : count.toLocaleString()}</p>
        <p className="text-[10px] text-text-faint">{label}</p>
      </div>
    </div>
  )
}

export function Browsers() {
  const browserProfiles = useAppStore((s) => s.browserProfiles)
  const cleanupItems = useAppStore((s) => s.cleanupItems)
  const selectIds = useAppStore((s) => s.selectIds)
  const autoSelected = useRef(false)

  useEffect(() => {
    if (autoSelected.current) return
    autoSelected.current = true
    const cacheIds = cleanupItems
      .filter((i) => i.category === 'browser' && i.safety === 'green' && !i.excluded)
      .map((i) => i.id)
    if (cacheIds.length) selectIds(cacheIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        title="Browser Cleanup"
        description="Cache is safe to clean and preselected below. Cookies and sessions need your review — passwords, bookmarks, and extensions are never touched."
      />

      {browserProfiles.map((browser) => {
        const items = cleanupItems.filter((i) => i.browserId === browser.id && !i.excluded)
        return (
          <Card key={browser.id} className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-semibold"
                  style={{ background: `${browser.accent}1a`, color: browser.accent }}
                >
                  {browser.name.charAt(0)}
                </div>
                <div>
                  <CardTitle>{browser.name}</CardTitle>
                  <p className="text-[12px] text-text-faint">Last cleaned: {browser.lastCleanedLabel}</p>
                </div>
              </div>
              <p className="text-[13px] font-medium text-text">
                {formatBytes(browser.cacheBytes + browser.cookiesBytes)} total
              </p>
            </CardHeader>
            <div className="mt-3 border-t border-border">
              {items.map((item) => (
                <CleanupItemRow key={item.id} item={item} />
              ))}
            </div>

            <CardBody>
              <p className="mb-2 text-[12px] font-medium text-text-muted">What will not be deleted</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ProtectedChip icon={KeyRound} label="Passwords" count={browser.passwordsCount} />
                <ProtectedChip icon={Bookmark} label="Bookmarks" count={browser.bookmarksCount} />
                <ProtectedChip icon={Type} label="Autofill entries" count={browser.autofillEntries} />
                <ProtectedChip icon={Puzzle} label="Extensions" count={browser.extensionsCount} />
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
