import { useEffect, useRef } from 'react'
import { Lock, KeyRound, Bookmark, Puzzle, Type } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { CleanupItemRow } from '@/components/cleanup/CleanupItemRow'
import { useAppStore } from '@/store/useAppStore'
import { useI18n } from '@/i18n'

function ProtectedChip({ icon: Icon, label, count }: { icon: typeof Lock; label: string; count: number | null }) {
  const { t, fmt } = useI18n()
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
      <Icon size={14} className="text-text-faint" />
      <div>
        <p className="text-[12px] font-medium text-text">{count === null ? t('brw.notScanned') : fmt.number(count)}</p>
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
  const { t, td, fmt } = useI18n()

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
        title={t('brw.title')}
        description={t('brw.description')}
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
                  <p className="text-[12px] text-text-faint">{t('brw.lastCleaned', { value: td(browser.lastCleanedLabel) })}</p>
                </div>
              </div>
              <p className="text-[13px] font-medium text-text">
                {t('brw.total', { size: fmt.bytes(browser.cacheBytes + browser.cookiesBytes) })}
              </p>
            </CardHeader>
            <div className="mt-3 border-t border-border">
              {items.map((item) => (
                <CleanupItemRow key={item.id} item={item} />
              ))}
            </div>

            <CardBody>
              <p className="mb-2 text-[12px] font-medium text-text-muted">{t('brw.notDeleted')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ProtectedChip icon={KeyRound} label={t('brw.passwords')} count={browser.passwordsCount} />
                <ProtectedChip icon={Bookmark} label={t('brw.bookmarks')} count={browser.bookmarksCount} />
                <ProtectedChip icon={Type} label={t('brw.autofill')} count={browser.autofillEntries} />
                <ProtectedChip icon={Puzzle} label={t('brw.extensions')} count={browser.extensionsCount} />
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
