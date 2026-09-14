//! Native macOS background scheduling via a per-user launchd LaunchAgent —
//! no root, no system daemon. The agent invokes this same app binary with
//! `--background-scan`; see background.rs for what that mode does.

use chrono::{DateTime, Datelike, Local, Months, Timelike};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub const LABEL: &str = "com.macstoragemanager.app.schedule";

fn launch_agents_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Library/LaunchAgents"))
}

fn plist_path() -> Option<PathBuf> {
    launch_agents_dir().map(|d| d.join(format!("{LABEL}.plist")))
}

fn current_uid() -> String {
    // whoami::id() as a portable-enough getuid — but whoami doesn't expose
    // the numeric uid, so shell out to `id -u`, which is always present.
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "0".to_string())
}

fn launchctl(args: &[&str]) -> std::io::Result<std::process::ExitStatus> {
    Command::new("launchctl").args(args).status()
}

/// A weekday/day-of-month anchor is picked once, from "now", at install
/// time — e.g. installing a weekly schedule on a Tuesday makes it a
/// recurring Tuesday schedule. Re-saving the schedule (even unchanged)
/// re-anchors it to the current day, which is an acceptable, documented
/// trade-off for keeping this simple.
fn build_plist_xml(executable: &str, frequency: &str, hour: u32, minute: u32, now: DateTime<Local>) -> String {
    let calendar_entries = match frequency {
        "daily" => vec![format!(
            "<dict><key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>{minute}</integer></dict>"
        )],
        "weekly" | "biweekly" => {
            // launchd has no native "every N weeks" primitive — biweekly
            // fires on the same weekly launchd trigger and self-throttles
            // in background.rs (skips unless >= ~14 days since last run).
            let weekday = now.weekday().num_days_from_sunday();
            vec![format!(
                "<dict><key>Weekday</key><integer>{weekday}</integer><key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>{minute}</integer></dict>"
            )]
        }
        "monthly" => {
            let day = now.day();
            vec![format!(
                "<dict><key>Day</key><integer>{day}</integer><key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>{minute}</integer></dict>"
            )]
        }
        _ => vec![format!(
            "<dict><key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>{minute}</integer></dict>"
        )],
    };

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{executable}</string>
        <string>--background-scan</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        {calendar}
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/com.macstoragemanager.app.schedule.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/com.macstoragemanager.app.schedule.log</string>
</dict>
</plist>
"#,
        calendar = calendar_entries.join("\n        "),
    )
}

/// Installs (or cleanly replaces) the LaunchAgent for the given frequency +
/// time-of-day ("HH:MM"). Always bootout-then-bootstrap, even on first
/// install, so this is idempotent — calling it repeatedly (every app
/// startup, every schedule save) never creates duplicate jobs.
pub fn install(frequency: &str, time_of_day: &str) -> Result<(), String> {
    let (hour, minute) = parse_time_of_day(time_of_day).ok_or_else(|| format!("Invalid time_of_day: {time_of_day}"))?;
    let executable = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    let path = plist_path().ok_or("Could not determine LaunchAgents directory")?;
    let dir = launch_agents_dir().ok_or("Could not determine LaunchAgents directory")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Unconditional bootout first (ignore failure — it's a no-op if nothing
    // was loaded) guarantees no duplicate/stale job survives a re-install.
    let _ = launchctl(&["bootout", &format!("gui/{}/{}", current_uid(), LABEL)]);

    let xml = build_plist_xml(&executable, frequency, hour, minute, Local::now());
    fs::write(&path, xml).map_err(|e| e.to_string())?;

    let status = launchctl(&["bootstrap", &format!("gui/{}", current_uid()), &path.to_string_lossy()])
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("launchctl bootstrap failed with status {status}"));
    }
    log::info!("Schedule LaunchAgent installed: {frequency} at {time_of_day} -> {executable}");
    Ok(())
}

/// Unloads and deletes the LaunchAgent. Safe to call even if nothing is
/// installed (bootout failure is ignored, missing file is ignored).
pub fn remove() -> Result<(), String> {
    let _ = launchctl(&["bootout", &format!("gui/{}/{}", current_uid(), LABEL)]);
    if let Some(path) = plist_path() {
        let _ = fs::remove_file(path);
    }
    log::info!("Schedule LaunchAgent removed");
    Ok(())
}

/// Best-effort "is a job currently loaded" check, for Settings/Schedule UI
/// diagnostics — not required for correctness of the schedule itself.
pub fn is_installed() -> bool {
    plist_path().map(|p| p.exists()).unwrap_or(false)
        && Command::new("launchctl")
            .args(["print", &format!("gui/{}/{}", current_uid(), LABEL)])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

/// If the app is running from a different path than the currently-installed
/// LaunchAgent references (e.g. the user moved the .app), reinstall pointed
/// at the new path. Called once at normal (foreground) startup when a
/// schedule is enabled — a lightweight self-heal for "moved", not "deleted"
/// (there's no way to self-heal after deletion — see docs/scheduled-scans.md).
pub fn reinstall_if_path_changed(frequency: &str, time_of_day: &str) {
    let Ok(current) = std::env::current_exe() else { return };
    let Some(path) = plist_path() else { return };
    let Ok(existing_xml) = fs::read_to_string(&path) else {
        // Nothing installed yet — nothing to heal.
        return;
    };
    if !existing_xml.contains(&current.to_string_lossy().to_string()) {
        log::info!("Detected app path change — reinstalling schedule LaunchAgent");
        let _ = install(frequency, time_of_day);
    }
}

fn parse_time_of_day(s: &str) -> Option<(u32, u32)> {
    let mut parts = s.split(':');
    let h: u32 = parts.next()?.trim().parse().ok()?;
    let m: u32 = parts.next()?.trim().parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some((h, m))
}

/// Computes the next run time strictly after `now`, anchored to
/// `time_of_day` and spaced by `frequency`. Used both when the user saves a
/// schedule (so the UI shows a real "Next run" immediately) and after a
/// background run completes (to advance it).
pub fn calculate_next_run_at(frequency: &str, time_of_day: &str, now: DateTime<Local>) -> Option<DateTime<Local>> {
    let (hour, minute) = parse_time_of_day(time_of_day)?;
    let mut candidate = now.with_hour(hour)?.with_minute(minute)?.with_second(0)?.with_nanosecond(0)?;
    if candidate <= now {
        candidate = advance_by_frequency(candidate, frequency)?;
    }
    // Guard against any pathological loop (e.g. malformed frequency) —
    // never iterate more than a year's worth of steps.
    let mut guard = 0;
    while candidate <= now && guard < 400 {
        candidate = advance_by_frequency(candidate, frequency)?;
        guard += 1;
    }
    Some(candidate)
}

fn advance_by_frequency(date: DateTime<Local>, frequency: &str) -> Option<DateTime<Local>> {
    match frequency {
        "daily" => date.checked_add_signed(chrono::Duration::days(1)),
        "weekly" => date.checked_add_signed(chrono::Duration::days(7)),
        "biweekly" => date.checked_add_signed(chrono::Duration::days(14)),
        "monthly" => date.checked_add_months(Months::new(1)),
        _ => date.checked_add_signed(chrono::Duration::days(1)),
    }
}

/// For biweekly's self-throttle: true once >= ~13.5 days have passed since
/// `last_run_at` (or if there's no last run at all — first fire is real).
pub fn biweekly_due(last_run_at: Option<&str>, now: DateTime<Local>) -> bool {
    let Some(raw) = last_run_at else { return true };
    let Ok(last) = DateTime::parse_from_rfc3339(raw) else { return true };
    let last_local = last.with_timezone(&Local);
    (now - last_local) >= chrono::Duration::hours(13 * 24 + 12)
}

pub fn now_rfc3339() -> String {
    Local::now().to_rfc3339()
}
