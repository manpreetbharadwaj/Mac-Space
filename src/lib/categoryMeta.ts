import {
  Code2,
  Globe,
  AppWindow,
  Download,
  FolderOpen,
  Cpu,
  FileText,
  Image,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'
import type { StorageCategoryId } from '@/types'

export const CATEGORY_ICON: Record<StorageCategoryId, LucideIcon> = {
  developer: Code2,
  browser: Globe,
  applications: AppWindow,
  downloads: Download,
  files: FolderOpen,
  system: Cpu,
  documents: FileText,
  media: Image,
  other: HelpCircle,
}

export const CATEGORY_COLOR: Record<StorageCategoryId, string> = {
  developer: '#3b82f6',
  browser: '#f59e0b',
  applications: '#a855f7',
  downloads: '#22c55e',
  files: '#64748b',
  system: '#ef4444',
  documents: '#06b6d4',
  media: '#ec4899',
  other: '#94a3b8',
}

export const CATEGORY_ROUTE: Partial<Record<StorageCategoryId, string>> = {
  developer: '/developer',
  browser: '/browsers',
  applications: '/applications',
  downloads: '/files',
  system: '/files',
  documents: '/files',
  media: '/files',
}
