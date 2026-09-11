// Decimal (SI/1000-based), matching how macOS itself displays storage
// (Finder, About This Mac, System Settings > Storage all use decimal GB) —
// not binary GiB. Using 1024-based math here while labeling it "GB" was the
// root cause of this app's numbers looking wrong next to System Settings.
const GB = 1000 ** 3
const MB = 1000 ** 2
const KB = 1000

export function formatBytes(bytes: number, precision = 1): string {
  if (bytes <= 0) return '0 MB'
  if (bytes >= GB) return `${(bytes / GB).toFixed(precision)} GB`
  if (bytes >= MB) return `${(bytes / MB).toFixed(precision)} MB`
  if (bytes >= KB) return `${(bytes / KB).toFixed(precision)} KB`
  return `${bytes} B`
}

export function formatBytesCompact(bytes: number): string {
  if (bytes >= GB) {
    const value = bytes / GB
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} GB`
  }
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`
  return `${(bytes / KB).toFixed(0)} KB`
}

export function gbToBytes(gb: number): number {
  return gb * GB
}

export function bytesToGb(bytes: number): number {
  return bytes / GB
}

export function formatPercent(value: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

export function formatRelativeDays(daysAgo: number): string {
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return `${daysAgo} days ago`
  if (daysAgo < 14) return '1 week ago'
  if (daysAgo < 30) return `${Math.floor(daysAgo / 7)} weeks ago`
  if (daysAgo < 60) return '1 month ago'
  if (daysAgo < 365) return `${Math.floor(daysAgo / 30)} months ago`
  return `${Math.floor(daysAgo / 365)} year${daysAgo >= 730 ? 's' : ''} ago`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function daysAgoIso(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
