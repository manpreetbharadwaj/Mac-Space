use crate::dto::{
    FullScanResultDto, PathAccessDto, ScanProgressEvent, ScanWarningDto, ScannedFileDto,
};
use crate::trash::{TrashOperationResult, TrashRequestItem};
use crate::{applications, browsers, dedup, developer, disk, scanner};
use crate::{schedule, state};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::{NotificationExt, PermissionState};

const PROGRESS_EVENT: &str = "scan-progress";
const CLEANUP_PROGRESS_EVENT: &str = "cleanup-progress";

fn emit_progress(app: &AppHandle, phase: &str, label: &str, done: bool) {
    let _ = app.emit(
        PROGRESS_EVENT,
        ScanProgressEvent {
            phase: phase.to_string(),
            label: label.to_string(),
            done,
        },
    );
}

fn emit_cleanup_progress(app: &AppHandle, phase: &str, label: &str, done: bool) {
    let _ = app.emit(
        CLEANUP_PROGRESS_EVENT,
        ScanProgressEvent {
            phase: phase.to_string(),
            label: label.to_string(),
            done,
        },
    );
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn get_system_overview() -> crate::dto::SystemOverviewDto {
    disk::get_system_overview()
}

#[tauri::command]
pub fn check_path_access(path: String) -> PathAccessDto {
    let state = scanner::path_access_state(Path::new(&path));
    PathAccessDto {
        path,
        state: state.to_string(),
    }
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Opens System Settings' Full Disk Access pane. We cannot grant this
/// permission programmatically — only the user can, in System Settings — so
/// this just takes them straight there instead of silently failing.
#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(crate) fn scan_all_files(home: &PathBuf) -> (Vec<ScannedFileDto>, Vec<ScanWarningDto>) {
    let mut files = Vec::new();
    let mut warnings = Vec::new();

    let file_roots: &[(&str, &str, u64, usize, usize)] = &[
        // (relative path, root label, min size bytes, max depth, max results)
        ("Downloads", "downloads", 1024 * 1024, 8, 500),
        ("Desktop", "desktop", 1024 * 1024, 8, 300),
        ("Documents", "documents", 1024 * 1024, 10, 500),
    ];

    for (relative, label, min_size, max_depth, max_results) in file_roots {
        let root = home.join(relative);
        let (found, warning) =
            scanner::scan_candidate_files(&root, label, *max_depth, *min_size, *max_results);
        files.extend(found);
        if let Some(w) = warning {
            warnings.push(w);
        }
    }

    let cache_roots: &[(&str, &str, u64, usize)] = &[
        ("Library/Caches", "system-caches", 5 * 1024 * 1024, 60),
        ("Library/Logs", "system-logs", 2 * 1024 * 1024, 40),
    ];

    for (relative, label, min_size, max_results) in cache_roots {
        let root = home.join(relative);
        let (found, warning) = scanner::scan_top_level_sizes(&root, label, *min_size, *max_results);
        files.extend(found);
        if let Some(w) = warning {
            warnings.push(w);
        }
    }

    (files, warnings)
}

/// Phase order intentionally matches the existing Scan screen's fixed step
/// list (Analyzing storage → Developer data → Browsers → Applications →
/// Downloads & files → Building recommendations) so that UI is never
/// redesigned — only the timing driving it becomes real.
#[tauri::command]
pub async fn run_full_scan(app: AppHandle) -> Result<FullScanResultDto, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;

    emit_progress(&app, "overview", "Analyzing storage…", false);
    let overview = disk::get_system_overview();

    emit_progress(&app, "developer", "Scanning developer tooling…", false);
    let home_for_dev = home.clone();
    let developer_items = tauri::async_runtime::spawn_blocking(move || {
        developer::scan_developer_storage(&home_for_dev)
    })
    .await
    .map_err(|e| e.to_string())?;

    emit_progress(&app, "browsers", "Scanning browser caches…", false);
    let home_for_browsers = home.clone();
    let browser_items = tauri::async_runtime::spawn_blocking(move || {
        browsers::scan_browser_storage(&home_for_browsers)
    })
    .await
    .map_err(|e| e.to_string())?;

    emit_progress(&app, "applications", "Scanning installed applications…", false);
    let home_for_apps = home.clone();
    let application_items = tauri::async_runtime::spawn_blocking(move || {
        applications::scan_applications(&home_for_apps)
    })
    .await
    .map_err(|e| e.to_string())?;

    emit_progress(&app, "files", "Scanning Downloads, Desktop & Documents…", false);
    let home_for_files = home.clone();
    let (files, warnings) = tauri::async_runtime::spawn_blocking(move || scan_all_files(&home_for_files))
        .await
        .map_err(|e| e.to_string())?;
    let files = tauri::async_runtime::spawn_blocking(move || {
        let mut files = files;
        dedup::mark_duplicate_candidates(&mut files);
        files
    })
    .await
    .map_err(|e| e.to_string())?;

    emit_progress(&app, "finalizing", "Calculating reclaimable storage…", true);

    log::info!(
        "run_full_scan complete: {} files, {} developer items, {} browsers, {} applications, {} warnings",
        files.len(),
        developer_items.len(),
        browser_items.len(),
        application_items.len(),
        warnings.len(),
    );

    Ok(FullScanResultDto {
        overview,
        files,
        developer: developer_items,
        browsers: browser_items,
        applications: application_items,
        warnings,
        scanned_at_ms: now_ms(),
    })
}

/// Moves each requested item to the macOS Trash (never a permanent delete —
/// see trash.rs). One item's failure never aborts the rest: every item gets
/// its own validated attempt and its own result. Disk overview is captured
/// tightly before/after so the frontend can report "moved to Trash" and
/// "freed on disk" as the two distinct, honest numbers they are — moving a
/// file to Trash on the same volume does not free space until Trash is
/// emptied.
#[tauri::command]
pub async fn trash_items(app: AppHandle, items: Vec<TrashRequestItem>) -> Result<TrashOperationResult, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let total = items.len();

    emit_cleanup_progress(&app, "preparing", "Preparing cleanup…", false);
    let overview_before = disk::get_system_overview();

    let mut results = Vec::with_capacity(total);
    for (index, item) in items.into_iter().enumerate() {
        emit_cleanup_progress(
            &app,
            "moving",
            &format!("Processing {} of {total}: {}", index + 1, item.name),
            false,
        );
        let home_for_item = home.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            crate::trash::trash_single_item(&home_for_item, &item)
        })
        .await
        .map_err(|e| e.to_string())?;
        results.push(result);
    }

    emit_cleanup_progress(&app, "verifying", "Verifying results…", false);
    let overview_after = disk::get_system_overview();
    emit_cleanup_progress(&app, "done", "Cleanup complete.", true);

    let success_count = results.iter().filter(|r| r.success).count();
    let failure_count = results.len() - success_count;
    log::info!(
        "trash_items complete: {} requested, {success_count} succeeded, {failure_count} failed",
        results.len(),
    );

    Ok(TrashOperationResult {
        results,
        overview_before,
        overview_after,
    })
}

/// Returns the full persisted app-state blob (settings/schedule/history/
/// scanEvents) — see state.rs. The frontend owns the shape; Rust only reads
/// a handful of fields out of it for the background scan job.
#[tauri::command]
pub fn get_app_state() -> serde_json::Value {
    state::load_state()
}

/// Persists the full app-state blob as-is (last-writer-wins — the frontend
/// always sends its complete current copy, matching how it previously
/// wrote the whole blob to localStorage in one shot).
#[tauri::command]
pub fn save_app_state(state: serde_json::Value) -> Result<(), String> {
    crate::state::save_state(&state)
}

/// Installs/replaces the LaunchAgent for the given frequency + time-of-day
/// and returns the freshly computed `nextRunAt` (RFC3339) so the UI can
/// show a real value immediately, without waiting for a background run.
#[tauri::command]
pub fn install_schedule(frequency: String, time_of_day: String) -> Result<String, String> {
    schedule::install(&frequency, &time_of_day)?;
    let next = schedule::calculate_next_run_at(&frequency, &time_of_day, chrono::Local::now())
        .map(|d| d.to_rfc3339())
        .ok_or_else(|| "Could not compute next run time".to_string())?;
    Ok(next)
}

/// Unloads and removes the LaunchAgent (called when the user disables
/// scheduling). Safe to call even if nothing is currently installed.
#[tauri::command]
pub fn remove_schedule() -> Result<(), String> {
    schedule::remove()
}

/// Whether a schedule LaunchAgent is currently loaded — diagnostic only,
/// shown in the Schedule screen so "should be enabled" and "is actually
/// installed" can never silently drift apart without the user noticing.
#[tauri::command]
pub fn get_schedule_status() -> bool {
    schedule::is_installed()
}

/// Re-points the installed LaunchAgent at the current executable if the app
/// has moved since it was installed (e.g. dragged to a new location) —
/// a no-op if nothing changed or nothing is installed. Called once at
/// normal startup when a schedule is enabled.
#[tauri::command]
pub fn heal_schedule_path(frequency: String, time_of_day: String) {
    schedule::reinstall_if_path_changed(&frequency, &time_of_day);
}

/// Best-effort notification permission read. IMPORTANT, verified by reading
/// tauri-plugin-notification 2.4.0's desktop backend source: on macOS this
/// always returns "granted" — the plugin does not currently query real
/// UNUserNotificationCenter authorization status on desktop. Exposed
/// honestly as-is; the frontend does not claim OS-level certainty from
/// this value alone (see docs/scheduled-scans.md).
#[tauri::command]
pub fn get_notification_permission_state(app: AppHandle) -> Result<String, String> {
    match app.notification().permission_state() {
        Ok(PermissionState::Granted) => Ok("granted".to_string()),
        Ok(PermissionState::Denied) => Ok("denied".to_string()),
        Ok(_) => Ok("prompt".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn request_notification_permission(app: AppHandle) -> Result<String, String> {
    match app.notification().request_permission() {
        Ok(PermissionState::Granted) => Ok("granted".to_string()),
        Ok(PermissionState::Denied) => Ok("denied".to_string()),
        Ok(_) => Ok("prompt".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn open_notification_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.notifications")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Consumes (clears) the route a notification click resolved to, if any —
/// called once by the frontend after it mounts. See native_notifications.rs
/// for the full native click -> pending route -> frontend handoff.
#[tauri::command]
pub fn get_pending_notification_route() -> Option<String> {
    crate::native_notifications::take_pending_route()
}
