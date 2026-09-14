# Scheduled Scans + Native Notifications

How real background scanning works, exactly what it does and doesn't do, and
the specific edge-case behaviors (missed runs, app moved/removed, permission
state) this implementation handles.

## Architecture

```
Frontend (Schedule screen)
   -> saveSchedule(rule)
        enabled=true  -> installSchedule(frequency, timeOfDay)  [Rust command]
        enabled=false -> removeSchedule()                       [Rust command]

Rust command layer (src-tauri/src/commands.rs)
   -> schedule::install() / schedule::remove()   (src-tauri/src/schedule.rs)
        writes ~/Library/LaunchAgents/com.macstoragemanager.app.schedule.plist
        launchctl bootstrap gui/$UID <plist>   (per-user, no root, no daemon)

launchd (StartCalendarInterval, native macOS)
   -> at the scheduled time, runs the SAME compiled app binary with a flag:
        <app executable> --background-scan

Same binary, headless branch (src-tauri/src/lib.rs -> background.rs)
   -> no window, no WebView, checked before tauri::Builder is touched at all
   -> runs the real read-only scanners, computes reclaimable bytes,
      updates schedule.lastRunAt/nextRunAt, appends a scanEvent,
      sends a native notification if a threshold is met
```

State (settings, schedule, history, scanEvents) lives in one JSON file —
`~/Library/Application Support/com.macstoragemanager.app/state.json` — read
and written by both the normal running app and the headless background
process. It replaced browser localStorage specifically because a headless
process has no WebView and therefore no localStorage to read.

## Frequencies and `nextRunAt`

`daily` / `weekly` / `biweekly` / `monthly`, each with a `timeOfDay` ("HH:MM",
24-hour). `schedule::calculate_next_run_at()` is the single source of truth
for "next run": it's called both when the user saves a schedule (so the UI
shows a real value immediately) and after every background run completes (to
advance it). It never trusts launchd's own idea of "next fire" — it computes
its own from `lastRunAt`/now + frequency, which is what both the UI and the
background job read.

launchd has no native "every N weeks" primitive, so `biweekly` is installed as
a **weekly** `StartCalendarInterval` trigger, and the background job
self-throttles: `schedule::biweekly_due()` skips the run (no scan, no
notification, no state change) unless roughly 13.5+ days have passed since
`lastRunAt`. This is a deliberate, documented trade-off rather than a bug —
launchd fires every week, the job itself decides whether it's actually due.

`weekly`/`biweekly` also anchor to a *day of week*, and `monthly` to a *day of
month*, taken from "now" at install time. Re-saving the schedule re-anchors
it to whatever day it's saved on — acceptable and simple, but means changing
only the time-of-day on, say, a Tuesday-anchored weekly schedule will also
silently re-anchor the weekday to today.

## Missed schedules (sleep/wake)

No custom polling or "did we miss it" logic was written — `StartCalendarInterval`
is native launchd behavior, and launchd's own documented behavior for it is:
if the Mac was asleep (or the user wasn't logged in) at the scheduled time, the
job fires once, shortly after wake/login, instead of being silently skipped.
This was chosen specifically so missed-schedule handling comes for free from
the OS rather than from custom code that could get it wrong.

## Duplicate-job prevention

`schedule::install()` always runs `launchctl bootout` before writing the new
plist and `bootstrap`-ing it — unconditionally, even on what looks like a
first install. This makes installing idempotent: saving the schedule
repeatedly, changing frequency/time, or the app re-asserting its schedule on
every normal startup (see below) can never produce two jobs for the same
label (`com.macstoragemanager.app.schedule`). Verified live: three
back-to-back installs with different frequencies left exactly one job and one
plist file, with the plist reflecting only the most recent install.

## Surviving app updates / app moved / app removed

- **Update, schedule stays enabled**: `heal_schedule_path()` is called once at
  every normal (foreground) app startup when `schedule.enabled` is true. It
  compares the currently-installed plist's executable path against
  `std::env::current_exe()`, and silently reinstalls (bootout + bootstrap)
  only if they differ — e.g. the user replaced the binary at the same
  install location, or dragged the .app somewhere else. If the path is
  unchanged, this is a no-op; it never touches `nextRunAt`/`lastRunAt`.
- **App moved**: same mechanism as above — the next time the app is opened,
  it notices the plist points at a stale path and repoints it.
- **App removed entirely / executable deleted**: there is no code running to
  notice this (nothing is running, by definition). The LaunchAgent stays
  installed and will keep firing on schedule. Each fire, launchd will fail to
  exec the missing binary and log a spawn failure — it does **not** retry in
  a tight loop or consume meaningful resources; `StartCalendarInterval` jobs
  simply wait for the next scheduled time and fail again, silently, from the
  user's perspective (nothing they'd see, no crash dialog, no repeated
  failure notification). This is disclosed as a known limitation rather than
  solved: a fully "clean" uninstall would require an uninstaller step (a
  `postinstall`/removal hook) that calls `schedule::remove()`, which does not
  exist yet because this app isn't signed/notarized or distributed via a
  package format with uninstall hooks in this phase. Not implemented:
  automatically detecting "my own executable disappeared" from inside a
  process that no longer exists is not solvable in-process; a system-level
  uninstall hook is the correct real fix for a future phase.

## Notifications

Uses `tauri-plugin-notification` (official Tauri v2 plugin). A notification
is sent from the background job only if **both**:
`settings.notificationsEnabled === true` **and** a threshold condition is
met (`freeBytes <= thresholdFreeGb` OR `reclaimableBytes >= thresholdReclaimableGb`).
Wording never implies automatic action:

- Low free space: `"Your Mac has only {N} GB free. Review storage recommendations."`
- Reclaimable ready: `"{N} GB can be reviewed for cleanup."`

**Verified, disclosed limitation** (read directly from
`tauri-plugin-notification` 2.4.0's desktop source, not assumed):
`permission_state()` / `request_permission()` are hardcoded to always return
`Granted` on desktop platforms — there is currently no real OS-level
`UNUserNotificationCenter` authorization query available through this
plugin's Rust API on macOS. The Settings/Schedule UI displays this value
as-is and does not claim it reflects a real macOS permission check; an "Open
Notification Settings" button is provided so the user can verify/control the
real OS-level setting directly in System Settings regardless of what the
in-app indicator says.

**Verified, mitigated limitation**: the plugin's desktop `.show()` posts the
actual OS notification call inside a fire-and-forget `tauri::async_runtime::spawn()`
task and returns before that task necessarily runs. Since the headless
background process exits immediately after finishing its work, it could exit
before the spawned task fires, silently dropping the notification. Mitigated
with a one-time `std::thread::sleep(1500ms)` after calling `.show()` before
the process is allowed to exit — negligible cost for a job that runs at most
a few times a day.

**Notification click**: no click/deep-link handler is registered in this
phase. A `route` extra (`/dashboard` or `/cleanup`) is attached to the
notification payload for a future phase to wire up, but clicking it today
does not navigate anywhere inside the app — at most, default macOS behavior
for the notification's associated app applies. This is an intentionally
disclosed limitation rather than a partial/broken implementation of
deep-linking.

## Safety

The background path (`background.rs`) only ever **reads** the filesystem
(via the same read-only scanners the interactive UI uses) and writes its own
`state.json`. There is no call to `trash_items`, permanent deletion, or app
uninstallation anywhere in the scheduled/background code path — scheduled
execution is scan + notify only, every time, unconditionally. The "Auto-clean
Safe items" schedule mode exists in the data model but is not wired to any
executing behavior yet; the Schedule UI marks it disabled with a "Coming
soon — currently notifies only" badge so the UI never claims a capability
that doesn't exist.

## Scan history

`scanEvents` (source: `"manual"` or `"scheduled"`) is a separate list from
`history` (real `CleanupSession` records, created only by actual cleanups).
A scheduled run never writes to `history` and never claims space was freed —
it only ever records that a scan happened, what it found, and whether a
notification was sent.
