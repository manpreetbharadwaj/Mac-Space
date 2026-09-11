import { HardDrive, Lock } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function Download() {
  return (
    <div className="mx-auto max-w-lg space-y-5 pb-16 text-center">
      <PageHeader title="Download for macOS" description="" />

      <Card>
        <CardBody className="py-10">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <HardDrive size={26} />
          </div>
          <h2 className="text-[17px] font-semibold text-text">Mac Storage Manager Desktop</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-text-muted">
            This React prototype demonstrates the full experience with mock data. The signed, notarized desktop app —
            built on this same interface with real macOS scanning — is coming soon.
          </p>

          <Button variant="secondary" disabled className="mx-auto mt-6">
            <Lock size={14} />
            Coming Soon
          </Button>

          <p className="mt-4 text-[11px] text-text-faint">
            Nothing on this screen scans or deletes real files — this build is a front-end prototype only.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
