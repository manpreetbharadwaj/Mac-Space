import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  RawFullScanResult,
  RawPathAccess,
  RawScanProgressEvent,
  RawSystemOverview,
} from './rawTypes'

export function getSystemOverview(): Promise<RawSystemOverview> {
  return invoke('get_system_overview')
}

export function checkPathAccess(path: string): Promise<RawPathAccess> {
  return invoke('check_path_access', { path })
}

export function revealInFinderNative(path: string): Promise<void> {
  return invoke('reveal_in_finder', { path })
}

export function openFullDiskAccessSettings(): Promise<void> {
  return invoke('open_full_disk_access_settings')
}

export function runFullScan(): Promise<RawFullScanResult> {
  return invoke('run_full_scan')
}

export function onScanProgress(callback: (event: RawScanProgressEvent) => void): Promise<UnlistenFn> {
  return listen<RawScanProgressEvent>('scan-progress', (e) => callback(e.payload))
}
