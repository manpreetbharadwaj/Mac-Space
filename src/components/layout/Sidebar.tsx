import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Sparkles,
  Code2,
  Globe,
  AppWindow,
  FolderOpen,
  CalendarClock,
  History,
  Settings,
  DownloadCloud,
  HardDrive,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '@/store/useAppStore'
import { formatBytes, formatPercent } from '@/lib/format'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/cleanup', label: 'Cleanup', icon: Sparkles },
  { to: '/developer', label: 'Developer', icon: Code2 },
  { to: '/browsers', label: 'Browsers', icon: Globe },
  { to: '/applications', label: 'Applications', icon: AppWindow },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/schedule', label: 'Schedule', icon: CalendarClock },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const diskSummary = useAppStore((s) => s.diskSummary)
  const dataSource = useAppStore((s) => s.dataSource)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4">
      <div className="flex items-center gap-2 px-2 pb-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-contrast">
          <HardDrive size={17} />
        </div>
        <div>
          <p className="text-[13px] font-semibold leading-tight text-text">Mac Storage</p>
          <p className="text-[11px] leading-tight text-text-faint">Manager</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text',
              )
            }
          >
            <item.icon size={16} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {dataSource === 'mock' && (
        <NavLink
          to="/download"
          className="mb-3 flex items-center justify-between rounded-lg border border-dashed border-border-strong px-2.5 py-2 text-[12px] font-medium text-text-faint hover:text-text-muted"
        >
          <span className="flex items-center gap-2">
            <DownloadCloud size={15} />
            Get Desktop App
          </span>
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px]">Soon</span>
        </NavLink>
      )}

      {import.meta.env.DEV && (
        <div
          className={clsx(
            'mb-3 flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium',
            dataSource === 'tauri' ? 'bg-safe-soft text-safe' : 'bg-surface-2 text-text-faint',
          )}
          title="Dev-only indicator — hidden in production builds"
        >
          <span className={clsx('h-1.5 w-1.5 rounded-full', dataSource === 'tauri' ? 'bg-safe' : 'bg-text-faint')} />
          {dataSource === 'tauri' ? 'Real Mac Data' : 'Mock Data'}
        </div>
      )}

      {diskSummary && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-text-muted">
            <span>Disk usage</span>
            <span>{formatPercent(diskSummary.usedBytes, diskSummary.totalBytes)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: formatPercent(diskSummary.usedBytes, diskSummary.totalBytes) }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-text-faint">
            {formatBytes(diskSummary.freeBytes)} available of {formatBytes(diskSummary.totalBytes)}
          </p>
        </div>
      )}
    </aside>
  )
}
