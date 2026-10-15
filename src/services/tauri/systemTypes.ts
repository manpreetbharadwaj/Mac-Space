/**
 * Raw shapes returned by the Performance / Mac Health commands — mirror the
 * Rust structs in src-tauri/src/{performance,processes,device_health,
 * login_item}.rs exactly (serde camelCase). `null` always means "macOS did
 * not expose this" and must render as "Unavailable", never as 0.
 */

export type PressureLevel = 'normal' | 'elevated' | 'critical'

export interface RawMemory {
  totalBytes: number
  usedBytes: number
  appBytes: number
  wiredBytes: number
  compressedBytes: number
  cachedFilesBytes: number
  freeBytes: number
  availableBytes: number
  usedPercent: number
  pressure: PressureLevel | null
  freePercent: number | null
  swapTotalBytes: number | null
  swapUsedBytes: number | null
  swapInsPerSec: number | null
  swapOutsPerSec: number | null
}

export interface RawCpu {
  usagePercent: number | null
  userPercent: number | null
  systemPercent: number | null
  idlePercent: number | null
  physicalCores: number | null
  logicalCores: number | null
  loadAverage: [number, number, number] | null
}

export interface RawBatteryBrief {
  present: boolean
  percent: number | null
  isCharging: boolean | null
  powerSource: string | null
  lowPowerMode: boolean | null
}

export interface RawSystem {
  processCount: number | null
  appCount: number | null
  backgroundCount: number | null
  systemCount: number | null
  uptimeSecs: number | null
  diskTotalBytes: number
  diskUsedBytes: number
  diskFreeBytes: number
  diskReadBytesPerSec: number | null
  diskWriteBytesPerSec: number | null
  battery: RawBatteryBrief | null
}

export interface RawHistoryPoint {
  t: number
  memoryPercent: number
  cpuPercent: number | null
  swapUsedBytes: number | null
}

export type AlertKind = 'memoryPressure' | 'swap' | 'appMemory' | 'cpu' | 'appCpu' | 'storage' | 'battery'

export interface RawActiveAlert {
  kind: AlertKind
  level: PressureLevel | null
  appName: string | null
  pid: number | null
  bytes: number | null
  percent: number | null
  condition: string | null
  sinceMs: number
}

export interface RawPerformanceSnapshot {
  monitoring: boolean
  intervalMs: number
  sampledAtMs: number
  memory: RawMemory | null
  cpu: RawCpu
  system: RawSystem
  history: RawHistoryPoint[]
  alerts: RawActiveAlert[]
  lastNotificationError: string | null
}

export type ProcessKind = 'app' | 'background' | 'system'
export type Protection = 'selfProcess' | 'kernel' | 'critical' | 'otherUser' | 'systemPath' | 'unverified'

export interface RawProcess {
  pid: number
  parentPid: number | null
  name: string
  bundleId: string | null
  path: string | null
  memoryBytes: number | null
  groupMemoryBytes: number | null
  groupCpuPercent: number | null
  helperCount: number
  cpuPercent: number | null
  kind: ProcessKind
  status: string | null
  isHidden: boolean | null
  isActive: boolean | null
  startTime: number
  user: string | null
  protection: Protection | null
  isAppHelper: boolean
}

export interface RawProcessList {
  processes: RawProcess[]
  totalCount: number
  appCount: number
  backgroundCount: number
  systemCount: number
  cpuMeasured: boolean
  diskReadBytesPerSec: number | null
  diskWriteBytesPerSec: number | null
  sampledAtMs: number
}

export interface RawProcessDetails {
  pid: number
  parentPid: number | null
  parentName: string | null
  name: string
  bundleId: string | null
  path: string | null
  user: string | null
  startTime: number
  runTimeSecs: number
  memoryBytes: number | null
  residentBytes: number | null
  virtualBytes: number | null
  diskReadTotalBytes: number | null
  diskWrittenTotalBytes: number | null
  cpuTimeSecs: number | null
  status: string | null
  kind: ProcessKind
  protection: Protection | null
}

export type TerminateOutcome =
  | 'exited'
  | 'stillRunning'
  | 'refused'
  | 'notFound'
  | 'identityMismatch'
  | 'protected'
  | 'permissionDenied'
  | 'failed'

export interface RawTerminateResult {
  outcome: TerminateOutcome
  protection: Protection | null
  message: string | null
}

export interface RawGpu {
  model: string
  coreCount: number | null
}

export interface RawDeviceInfo {
  modelName: string | null
  modelIdentifier: string | null
  modelNumber: string | null
  serialAvailable: boolean
  processorKind: 'appleSilicon' | 'intel' | null
  chipName: string | null
  physicalCores: number | null
  logicalCores: number | null
  performanceCores: number | null
  efficiencyCores: number | null
  gpus: RawGpu[]
  memoryBytes: number | null
  osVersion: string | null
  osBuild: string | null
  architecture: string | null
  runningUnderRosetta: boolean
  uptimeSecs: number | null
  bootTimeMs: number | null
}

export interface RawVolume {
  name: string
  mountPoint: string
  fileSystem: string
  totalBytes: number
  availableBytes: number
  isRemovable: boolean
  kind: 'ssd' | 'hdd' | 'unknown'
  isInternalStartup: boolean
}

export interface RawStorageHealth {
  volumeName: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  purgeableBytes: number
  volumes: RawVolume[]
  internalDisk: { model: string | null; mediumType: string | null; interconnect: string | null } | null
}

export interface RawBattery {
  present: boolean
  percent: number | null
  isCharging: boolean | null
  externalConnected: boolean | null
  fullyCharged: boolean | null
  powerSource: string | null
  cycleCount: number | null
  condition: string | null
  designCapacityMah: number | null
  fullChargeCapacityMah: number | null
  maximumCapacityPercent: number | null
  temperatureC: number | null
  timeToEmptyMin: number | null
  timeToFullMin: number | null
  lowPowerMode: boolean | null
}

export type NativeNotificationStatus =
  | 'authorized'
  | 'denied'
  | 'notDetermined'
  | 'provisional'
  | 'ephemeral'
  | 'unknown'
  | 'unavailable'

export interface RawTestNotificationResult {
  outcome: 'sent' | 'denied' | 'unavailable' | 'failed'
  authorization: NativeNotificationStatus | null
}

export interface RawLoginItemStatus {
  state: 'enabled' | 'disabled' | 'requiresApproval' | 'unavailable'
  detail: string | null
}

/** Sent to `configure_performance_monitor` — mirrors `MonitorConfig`. */
export interface MonitorConfigPayload {
  enabled: boolean
  refreshIntervalMs: number
  notificationsEnabled: boolean
  memoryAlert: boolean
  cpuAlert: boolean
  appAlert: boolean
  storageAlert: boolean
  batteryAlert: boolean
  sensitivity: string
  cpuThresholdPercent: number
  appMemoryThresholdBytes: number
  storageFreeThresholdBytes: number
  cooldownMinutes: number
  text: Record<string, string>
}
