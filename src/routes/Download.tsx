import { HardDrive, Lock } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/i18n'

export function Download() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-lg space-y-5 pb-16 text-center">
      <PageHeader title={t('dl.title')} description="" />

      <Card>
        <CardBody className="py-10">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <HardDrive size={26} />
          </div>
          <h2 className="text-[17px] font-semibold text-text">{t('dl.heading')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-text-muted">
            {t('dl.body')}
          </p>

          <Button variant="secondary" disabled className="mx-auto mt-6">
            <Lock size={14} />
            {t('dl.comingSoon')}
          </Button>

          <p className="mt-4 text-[11px] text-text-faint">
            {t('dl.note')}
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
