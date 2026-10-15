# Performance, Mac Health, notifications & languages

How the Performance and Mac Health screens get their data, what the alerts do,
and what macOS does and doesn't let an app see. Everything runs locally; no
data leaves the Mac.

## Where each number comes from

| Screen value | Source (native, `src-tauri/src/`) | Notes |
|---|---|---|
| Memory used / app / wired / compressed / cached | `host_statistics64(HOST_VM_INFO64)` — `sysmetrics.rs` | Same breakdown as Activity Monitor. **Cached files are not counted as used**: macOS reclaims them on demand. Verified against `vm_stat` to within sampling noise. |
| Memory pressure | `sysctl kern.memorystatus_vm_pressure_level` (1/2/4 → Normal/Elevated/Critical) | The kernel's own signal. |
| Free for new allocations | `sysctl kern.memorystatus_level` | What `memory_pressure` prints as "System-wide memory free percentage". |
| Swap used, swapping now | `sysctl vm.swapusage`, swap-in/out deltas | |
| CPU user / system / idle | `host_statistics(HOST_CPU_LOAD_INFO)` tick deltas | `nice` counts as user. |
| Load average, cores, uptime, boot time | `getloadavg`, `hw.physicalcpu`/`hw.logicalcpu`, `kern.boottime` | |
| Per-process memory | `proc_pid_rusage` → `ri_phys_footprint` | Activity Monitor's "Memory" column. Includes compressed/swapped pages. |
| Per-process CPU, disk I/O | `sysinfo` (libproc) | % of one core. Shown as "Measuring…" until two real intervals exist. |
| Apps vs background, names, icons | `NSWorkspace.runningApplications` | App = activation policy Regular. Helpers inside an app bundle are folded into the app's total ("incl. N helper processes"). |
| Model name, identifier | IORegistry `IODeviceTree:/product` `product-name`; `IOPlatformExpertDevice` `model` | Intel: System Information's cached name. |
| Serial number | `IOPlatformExpertDevice` `IOPlatformSerialNumber` | Only fetched on an explicit **Reveal** click (`reveal_serial_number`). Never stored, logged, or included in diagnostics. |
| GPU | `IOAccelerator` `model`, `gpu-core-count` | |
| Storage | Existing `disk::get_system_overview` (same as the cleaner) + `sysinfo::Disks` for other volumes | |
| Battery | `IOPowerSources` (charge, state, condition) + `AppleSmartBattery` (cycles, capacities, temperature) | Maximum capacity = `NominalChargeCapacity ÷ DesignCapacity` — matched System Settings exactly on a test M1 (81%). |
| Low Power Mode | `NSProcessInfo.isLowPowerModeEnabled` | macOS 12+. |
| Launch at login | `SMAppService.mainAppService` | macOS 13+. Status is read from macOS, never stored. |

Anything macOS doesn't expose shows **Unavailable** — never a guessed value.
Processes owned by other users (root daemons) show **Restricted** memory/CPU:
macOS doesn't allow a normal app to read them, and no elevation is attempted.

Not shown, on purpose: SSD SMART status and wear. They aren't readable through
a public API without a privileged helper, so the app says so instead.

## Sampling and battery impact

One native thread (`performance.rs`) does all sampling:

- Performance screen visible → every *Refresh interval* (default 2 s).
- Otherwise, if any alert is on → every 15 s, and the process table is only
  scanned when an app-level alert is even possible (memory pressure, or
  overall CPU high enough for one process to be pinning a core).
- Monitoring off, or nothing needs it → the thread is parked (no work at all).

"Visible" is a heartbeat from the screen; a hidden or minimized window stops
the heartbeat, so the fast pace stops on its own. A full sample of ~700
processes measured at ~12 ms CPU (release build, M1).

## Alerts and notifications

Detection is native, so it works while the window is closed (the app process
still running). Rules (`evaluate_alerts`, unit-tested):

- A condition must hold continuously for the sensitivity window (Low ≈ 5 min,
  Balanced ≈ 2 min, High ≈ 45 s). Flapping resets the timer.
- **An app is never flagged for high memory alone** — only while the system is
  also under memory pressure.
- Each alert key has a cooldown (Settings › Notifications, default 30 min;
  storage ≥ 6 h; battery 24 h) so a persisting condition notifies once.
- Nothing is ever terminated automatically.

Notifications go through `UNUserNotificationCenter` (the same path scheduled
scans use), in the user's language (templates are sent from the frontend's
i18n catalog), and open the Performance screen when clicked. macOS Focus and
notification settings apply as usual. They only work in a packaged `.app`;
`tauri dev` has no bundle identity, and the UI says so.

## Quit / Force Quit safety

`processes::terminate` re-checks everything natively right before acting:

1. PID **and kernel start time** must match what the user saw (PID-reuse guard).
2. Refused: this app, PID 0/1, named critical services (WindowServer,
   loginwindow, Finder, Dock, …), anything owned by another user, and
   non-app processes in system locations — including the simulated OS's
   daemons inside running iOS simulators and Xcode's device services
   (`/Library/Developer/CoreSimulator/`, `/Library/Developer/PrivateFrameworks/`).
   Apple's own apps (Safari, Music…) are ordinary apps and can be quit.
3. Quit = `NSRunningApplication.terminate` (like ⌘Q; the app may ask to save)
   or `SIGTERM`. Force Quit = `forceTerminate`/`SIGKILL`, only after a
   confirmation dialog.
4. The result reported is what happened: polled until the process is gone, or
   "still running" after the timeout.

## Languages

16 languages; every UI string in every screen is translated (catalogs in
`src/i18n/locales/` and `src/i18n/locales/app/`, both validated to have every
English key and matching `{placeholders}` in all 16 languages). Plurals use
`Intl.PluralRules` (Russian one/few/many, Arabic zero…many). Numbers, sizes,
dates and relative times use `Intl` in the chosen language.

Text produced outside React — classifier explanations, permission
descriptions, Rust trash-failure reasons and cleanup progress, "3 days ago"
labels — is translated at render time by `src/i18n/dataText.ts`, which matches
the English source text (with `{placeholder}` patterns). The cleaner's data
model is untouched. Anything unrecognised (file/app names, paths) is shown
as-is with `dir="auto"` so it renders correctly inside right-to-left Arabic.

Not translated: the browser prototype's demo data, and Remote Config
update/maintenance text authored server-side (shown as provided; the built-in
fallbacks are translated).

## Logs

`~/Library/Logs/com.macstoragemanager.app/` records, locally: monitor
configuration, each alert condition when it becomes sustained, and each
notification posted (title and body). No process data leaves the Mac.

## Ad-hoc–signed builds

Local builds are signed ad hoc (`signingIdentity "-"`), so their code identity
is a hash that changes on every rebuild. macOS ties privacy grants (folder
access prompts) and, at times, notification authorization to that identity,
so a rebuilt app may ask again — and until the folder prompts are answered the
startup data load waits. A Developer ID–signed release keeps one identity.

## Diagnostics

```
"Mac Storage Manager.app/Contents/MacOS/app" --print-system-health
```

Prints exactly what the two screens receive, as JSON (no serial number), for
comparison with Activity Monitor / System Information.

Live termination test against TextEdit and Chess (launches them hidden):

```
cd src-tauri && cargo test real_app -- --ignored --nocapture
```
