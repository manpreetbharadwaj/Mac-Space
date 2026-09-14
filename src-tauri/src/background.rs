//! Entry point for `--background-scan`: launched by launchd (see schedule.rs)
//! with no window, no WebView. Runs a real scan, computes an approximate
//! reclaimable-storage figure, updates schedule bookkeeping, and — only if
//! conditions are met — sends a native notification.
//!
//! Two modes, both read from `schedule.mode`:
//! - `"reminder"` (default): scan + notify only. Never trashes anything.
//! - `"auto-clean"`: scan, then run the strict native eligibility policy
//!   (see auto_clean.rs) and trash only what independently clears every gate
//!   — exclusions, path re-validation, per-run caps. Everything else in this
//!   mode behaves exactly like reminder mode.
//!
//! See the SAFETY note on `run()` for the invariant that makes this
//! trustworthy: this file never trusts frontend-provided safety labels, and
//! the only thing capable of moving a file to Trash here is the exact same
//! `trash::trash_single_item` primitive manual cleanup uses.

use crate::dto::{BrowserItemDto, DevItemDto, ScannedFileDto};
use crate::trash::TrashRequestItem;
use crate::{auto_clean, browsers, commands, dedup, developer, disk, native_notifications, schedule, state};
use serde_json::json;

/// SAFETY: the only path in this file that can ever remove/move a user file
/// is `run_auto_clean`, and only when ALL of the following are independently
/// true, re-checked natively (never taken on the frontend's word):
///   1. `schedule.mode == "auto-clean"`.
///   2. `schedule.autoCleanConsentVersion >= auto_clean::POLICY_VERSION` —
///      the user explicitly confirmed the current policy version; a stale
///      or missing consent value silently falls back to scan+notify only.
///   3. Each candidate independently clears `auto_clean::evaluate()`'s
///      strict allowlist (kind AND path-shape re-check), is not
///      user-excluded, and is not sensitive-keyword-flagged.
///   4. Each candidate then *still* passes `trash::validate_path` /
///      `trash::trash_single_item` unchanged — the same gauntlet manual
///      cleanup uses (canonicalization, home-directory scoping, protected
///      path denylist, symlink-escape rejection).
///   5. Per-run byte and item caps are enforced — never exceeded.
/// No `tauri::Builder`/window/WebView is ever touched here, directly or
/// indirectly — notifications go through `native_notifications::send`, which
/// talks to `UNUserNotificationCenter` directly. That keeps this path
/// guaranteed headless: a scheduled run, in either mode, can never open the
/// GUI.
/// Debug-only escape hatch letting auto-clean's real end-to-end path
/// (scan → evaluate → trash) be exercised against a disposable synthetic
/// home directory instead of the real one, for testing. Compiled out
/// entirely — not just disabled — in release builds via `cfg(debug_assertions)`,
/// so a packaged app has no code path that ever reads this env var; there is
/// nothing here for a shipped binary to expose.
#[cfg(debug_assertions)]
fn test_home_override() -> Option<std::path::PathBuf> {
    std::env::var("MSM_TEST_HOME").ok().map(std::path::PathBuf::from)
}
#[cfg(not(debug_assertions))]
fn test_home_override() -> Option<std::path::PathBuf> {
    None
}

pub fn run(dry_run: bool) {
    let mut app_state = state::load_state();
    let Some(home) = test_home_override().or_else(dirs::home_dir) else {
        log::error!("[background-scan] could not determine home directory — aborting");
        return;
    };

    if dry_run {
        run_dry_run(&home, &app_state);
        return;
    }

    let enabled = state::get_bool(&app_state, &["schedule", "enabled"], false);
    if !enabled {
        log::info!("[background-scan] schedule disabled — exiting without scanning");
        return;
    }

    let frequency = state::get_str(&app_state, &["schedule", "frequency"]).unwrap_or("weekly").to_string();
    let time_of_day = state::get_str(&app_state, &["schedule", "timeOfDay"]).unwrap_or("09:00").to_string();
    let last_run_at = state::get_str(&app_state, &["schedule", "lastRunAt"]).map(String::from);
    let mode = state::get_str(&app_state, &["schedule", "mode"]).unwrap_or("reminder").to_string();
    let consent_version = state::get_f64(&app_state, &["schedule", "autoCleanConsentVersion"], 0.0) as u32;

    let now = chrono::Local::now();
    if frequency == "biweekly" && !schedule::biweekly_due(last_run_at.as_deref(), now) {
        log::info!("[background-scan] biweekly schedule not due yet — exiting without scanning");
        return;
    }

    let notifications_enabled = state::get_bool(&app_state, &["settings", "notificationsEnabled"], true);
    let exclusions = state::get_str_array(&app_state, &["settings", "exclusions"]);
    let safe_categories = state::get_str_array(&app_state, &["schedule", "safeCategories"]);
    let threshold_free_gb = state::get_f64(&app_state, &["schedule", "thresholdFreeGb"], 40.0);
    let threshold_reclaimable_gb = state::get_f64(&app_state, &["schedule", "thresholdReclaimableGb"], 15.0);

    log::info!("[background-scan] starting scan (frequency={frequency}, mode={mode})");
    let overview_before = disk::get_system_overview();
    // Each scanner already degrades gracefully (returns fewer/no items)
    // rather than erroring when a path is inaccessible — a denied
    // permission in one category never aborts the others.
    let developer_items = developer::scan_developer_storage(&home);
    let browser_items = browsers::scan_browser_storage(&home);
    let (mut files, _warnings) = commands::scan_all_files(&home);
    dedup::mark_duplicate_candidates(&mut files);

    let reclaimable_bytes = estimate_reclaimable_bytes(&developer_items, &browser_items, &files, &safe_categories, &exclusions);
    let free_bytes = overview_before.free_bytes;

    log::info!(
        "[background-scan] scan complete: reclaimable≈{reclaimable_bytes} bytes, free={free_bytes} bytes, {} dev items, {} browsers, {} files",
        developer_items.len(),
        browser_items.len(),
        files.len(),
    );

    // --- Auto-clean (only if genuinely eligible; falls through to the
    // normal reminder notification logic below otherwise) ---
    let mut auto_clean_outcome: Option<AutoCleanOutcome> = None;
    if mode == "auto-clean" {
        if consent_version >= auto_clean::POLICY_VERSION {
            auto_clean_outcome = run_auto_clean(&home, &developer_items, &exclusions, &overview_before, &mut app_state);
        } else {
            log::warn!(
                "[background-scan] mode is auto-clean but consent version ({consent_version}) is behind the current policy ({}) — treating this run as reminder-only",
                auto_clean::POLICY_VERSION
            );
        }
    }

    let threshold_reclaimable_bytes = (threshold_reclaimable_gb * 1_000_000_000.0) as u64;
    let threshold_free_bytes = (threshold_free_gb * 1_000_000_000.0) as u64;
    let low_space = free_bytes <= threshold_free_bytes;
    let reclaimable_ready = reclaimable_bytes >= threshold_reclaimable_bytes;

    let mut notification_sent = false;
    if let Some(outcome) = &auto_clean_outcome {
        log::info!(
            "[background-scan] auto-clean outcome: {} succeeded, {} failed, {} byte(s) moved",
            outcome.success_count,
            outcome.failure_count,
            outcome.moved_bytes,
        );
        // A real cleanup happened — always tell the user what occurred
        // (subject to the notifications toggle), instead of the generic
        // "review your storage" reminder, which would be a stale/confusing
        // thing to say right after real action was already taken.
        if notifications_enabled {
            notification_sent = send_auto_clean_summary(outcome);
        } else {
            log::info!("[background-scan] notifications disabled in settings — skipping auto-clean summary");
        }
    } else if notifications_enabled && (low_space || reclaimable_ready) {
        notification_sent = send_notification(low_space, free_bytes, reclaimable_bytes);
    } else if !notifications_enabled {
        log::info!("[background-scan] notifications disabled in settings — skipping");
    } else {
        log::info!("[background-scan] no threshold met — skipping notification");
    }

    // Record bookkeeping — lastRunAt/nextRunAt and a scan-only history
    // entry. Never touches `history` (real CleanupSession records) directly
    // here — `run_auto_clean` above already pushed its own CleanupSession
    // into `history` if it ran, entirely separately from this ScanEvent.
    let next_run_at = schedule::calculate_next_run_at(&frequency, &time_of_day, now).map(|d| d.to_rfc3339());
    state::set_path(&mut app_state, &["schedule", "lastRunAt"], json!(schedule::now_rfc3339()));
    state::set_path(&mut app_state, &["schedule", "nextRunAt"], json!(next_run_at));
    state::push_capped(
        &mut app_state,
        "scanEvents",
        json!({
            "id": format!("scan-{}", chrono::Local::now().timestamp_millis()),
            "occurredAt": schedule::now_rfc3339(),
            "source": "scheduled",
            "foundBytes": overview_before.used_bytes,
            "reclaimableBytes": reclaimable_bytes,
            "freeBytes": free_bytes,
            "notificationSent": notification_sent,
        }),
        50,
    );

    if let Err(e) = state::save_state(&app_state) {
        log::error!("[background-scan] failed to save state: {e}");
    }
}

struct AutoCleanOutcome {
    moved_bytes: u64,
    success_count: usize,
    failure_count: usize,
}

/// Runs the strict eligibility policy, applies caps, and — only for
/// candidates that survive every gate — trashes them via the exact same
/// native primitive manual cleanup uses. Writes a `CleanupSession` (source
/// `"scheduled-auto-clean"`) to `history` if anything was attempted. Returns
/// `None` if nothing was eligible or the eligible total was below the
/// minimum threshold (no cleanup attempted at all in that case).
fn run_auto_clean(
    home: &std::path::PathBuf,
    developer_items: &[DevItemDto],
    exclusions: &[String],
    overview_before: &crate::dto::SystemOverviewDto,
    app_state: &mut serde_json::Value,
) -> Option<AutoCleanOutcome> {
    // Debug-only overrides so the real threshold/cap logic can be exercised
    // against small, fast, disposable test fixtures instead of requiring
    // multi-gigabyte dummy files — compiled out entirely in release builds,
    // same as `test_home_override` above.
    #[cfg(debug_assertions)]
    let (min_eligible_bytes, max_bytes_per_run, max_items_per_run) = (
        std::env::var("MSM_TEST_MIN_ELIGIBLE_BYTES").ok().and_then(|v| v.parse().ok()).unwrap_or(auto_clean::MIN_ELIGIBLE_BYTES),
        std::env::var("MSM_TEST_MAX_BYTES_PER_RUN").ok().and_then(|v| v.parse().ok()).unwrap_or(auto_clean::MAX_BYTES_PER_RUN),
        std::env::var("MSM_TEST_MAX_ITEMS_PER_RUN").ok().and_then(|v| v.parse().ok()).unwrap_or(auto_clean::MAX_ITEMS_PER_RUN),
    );
    #[cfg(not(debug_assertions))]
    let (min_eligible_bytes, max_bytes_per_run, max_items_per_run) =
        (auto_clean::MIN_ELIGIBLE_BYTES, auto_clean::MAX_BYTES_PER_RUN, auto_clean::MAX_ITEMS_PER_RUN);

    let report = auto_clean::evaluate(developer_items, home, exclusions);

    log::info!(
        "[auto-clean] eligibility: {} candidate(s), {} byte(s) eligible, {} skipped",
        report.eligible.len(),
        report.eligible_bytes,
        report.skipped.len(),
    );
    for skip in &report.skipped {
        log::info!("[auto-clean] skipped {}: {}", skip.path, skip.reason);
    }

    if report.eligible_bytes < min_eligible_bytes {
        log::info!(
            "[auto-clean] eligible bytes ({}) below minimum threshold ({}) — no cleanup this run",
            report.eligible_bytes,
            min_eligible_bytes,
        );
        return None;
    }

    let (to_clean, deferred) = auto_clean::apply_caps(report.eligible, max_bytes_per_run, max_items_per_run);
    if !deferred.is_empty() {
        let deferred_bytes: u64 = deferred.iter().map(|c| c.size_bytes).sum();
        log::info!(
            "[auto-clean] {} eligible item(s) totaling {} byte(s) deferred to a later run (per-run cap reached)",
            deferred.len(),
            deferred_bytes,
        );
    }

    log::info!("[auto-clean] cleaning {} item(s)", to_clean.len());

    let mut moved_bytes: u64 = 0;
    let mut success_count = 0usize;
    let mut item_ids = Vec::new();
    let mut failures = Vec::new();
    let mut category_bytes: u64 = 0;

    for candidate in &to_clean {
        let request = TrashRequestItem {
            id: candidate.id.clone(),
            name: candidate.name.clone(),
            path: candidate.path.clone(),
            size_bytes: candidate.size_bytes,
            // Every candidate here has already independently cleared the
            // strict auto-clean allowlist — never taken from frontend/state
            // input, computed fresh a few lines above.
            safety: "green".to_string(),
        };
        let result = crate::trash::trash_single_item(home, &request);
        if result.success {
            success_count += 1;
            moved_bytes += result.bytes_processed;
            category_bytes += result.bytes_processed;
            item_ids.push(candidate.id.clone());
            log::info!("[auto-clean] moved to Trash: {} ({} bytes)", candidate.path, result.bytes_processed);
        } else {
            let reason = result.failure_reason.clone().unwrap_or_else(|| "Unknown error".to_string());
            log::warn!("[auto-clean] failed to move {}: {reason}", candidate.path);
            failures.push(json!({
                "path": candidate.path,
                "name": candidate.name,
                "reason": reason,
            }));
        }
    }

    let failure_count = failures.len();
    let estimated_bytes: u64 = to_clean.iter().map(|c| c.size_bytes).sum();
    let overview_after = disk::get_system_overview();
    // Honest and separate from `moved_bytes` ("moved to Trash") — moving
    // files to Trash on the same volume does not free disk space until
    // Trash is emptied, so this is almost always ~0 immediately after.
    let freed_on_disk_bytes = overview_before.used_bytes.saturating_sub(overview_after.used_bytes);

    state::push_capped(
        app_state,
        "history",
        json!({
            "id": format!("autoclean-{}", chrono::Local::now().timestamp_millis()),
            "completedAt": schedule::now_rfc3339(),
            "source": "scheduled-auto-clean",
            "estimatedBytes": estimated_bytes,
            "actualBytes": moved_bytes,
            "itemIds": item_ids,
            "categoryBreakdown": if category_bytes > 0 { json!([{ "category": "developer", "bytes": category_bytes }]) } else { json!([]) },
            "beforeUsedBytes": overview_before.used_bytes,
            "afterUsedBytes": overview_after.used_bytes,
            "itemCount": success_count,
            "successCount": success_count,
            "failureCount": failure_count,
            "failures": failures,
            "freedOnDiskBytes": freed_on_disk_bytes,
        }),
        50,
    );

    log::info!(
        "[auto-clean] complete: {success_count} succeeded, {failure_count} failed, {moved_bytes} byte(s) moved to Trash"
    );

    Some(AutoCleanOutcome { moved_bytes, success_count, failure_count })
}

fn send_auto_clean_summary(outcome: &AutoCleanOutcome) -> bool {
    let gb = outcome.moved_bytes as f64 / 1_000_000_000.0;
    let body = if outcome.failure_count == 0 {
        format!("Auto-clean moved {gb:.1} GB of safe cache data to Trash.")
    } else {
        format!(
            "Auto-clean moved {gb:.1} GB to Trash — {} item{} couldn't be moved.",
            outcome.failure_count,
            if outcome.failure_count == 1 { "" } else { "s" },
        )
    };
    let sent = native_notifications::send("Mac Storage Manager", &body, "/history");
    if sent {
        log::info!("[background-scan] auto-clean summary notification sent: {body}");
    } else {
        log::warn!("[background-scan] auto-clean summary notification did not confirm success");
    }
    sent
}

/// Runs the scan + eligibility pipeline exactly as a real run would, but
/// never calls Trash and never writes state — a read-only diagnostic to
/// validate the policy on a real Mac before enabling unattended cleanup.
/// Always evaluates auto-clean eligibility regardless of the persisted
/// mode/enabled/consent state, since previewing "what would happen" is the
/// entire point.
fn run_dry_run(home: &std::path::PathBuf, app_state: &serde_json::Value) {
    let exclusions = state::get_str_array(app_state, &["settings", "exclusions"]);

    println!("[dry-run] scanning {}...", home.display());
    let developer_items = developer::scan_developer_storage(home);
    println!("[dry-run] found {} developer item(s)", developer_items.len());

    let report = auto_clean::evaluate(&developer_items, home, &exclusions);

    println!("[dry-run] === Auto-clean eligibility report ===");
    println!("[dry-run] eligible candidates: {}", report.eligible.len());
    println!("[dry-run] eligible bytes: {} ({:.2} GB)", report.eligible_bytes, report.eligible_bytes as f64 / 1e9);
    for c in &report.eligible {
        println!("[dry-run]   ELIGIBLE  kind={:<18} size={:>12} path={}", c.kind, c.size_bytes, c.path);
    }
    println!("[dry-run] skipped: {}", report.skipped.len());
    for s in &report.skipped {
        println!("[dry-run]   SKIPPED   reason=\"{}\" path={}", s.reason, s.path);
    }

    let meets_threshold = report.eligible_bytes >= auto_clean::MIN_ELIGIBLE_BYTES;
    println!(
        "[dry-run] minimum threshold ({:.2} GB): {}",
        auto_clean::MIN_ELIGIBLE_BYTES as f64 / 1e9,
        if meets_threshold { "MET — a real run would proceed to caps/cleanup" } else { "NOT MET — a real run would scan+notify only, no cleanup" }
    );

    if meets_threshold {
        let (to_clean, deferred) = auto_clean::apply_caps(report.eligible, auto_clean::MAX_BYTES_PER_RUN, auto_clean::MAX_ITEMS_PER_RUN);
        let to_clean_bytes: u64 = to_clean.iter().map(|c| c.size_bytes).sum();
        println!(
            "[dry-run] within caps (max {} items / {:.2} GB): {} item(s), {:.2} GB would be moved to Trash",
            auto_clean::MAX_ITEMS_PER_RUN,
            auto_clean::MAX_BYTES_PER_RUN as f64 / 1e9,
            to_clean.len(),
            to_clean_bytes as f64 / 1e9,
        );
        if !deferred.is_empty() {
            println!("[dry-run] deferred by cap: {} item(s) would be left for a later run", deferred.len());
        }
    }
    println!("[dry-run] === no files were moved or deleted — this was read-only ===");
}

fn estimate_reclaimable_bytes(
    developer_items: &[DevItemDto],
    browser_items: &[BrowserItemDto],
    files: &[ScannedFileDto],
    safe_categories: &[String],
    exclusions: &[String],
) -> u64 {
    let is_excluded = |path: &str| exclusions.iter().any(|ex| path == ex || path.starts_with(&format!("{ex}/")));
    let mut total: u64 = 0;

    if safe_categories.iter().any(|c| c == "developer") {
        total += developer_items.iter().filter(|i| !is_excluded(&i.path)).map(|i| i.size_bytes).sum::<u64>();
    }
    if safe_categories.iter().any(|c| c == "browser") {
        total += browser_items.iter().filter(|i| !is_excluded(&i.cache_path)).map(|i| i.cache_bytes).sum::<u64>();
    }
    let files_category_matches = |root: &str| match root {
        "downloads" => safe_categories.iter().any(|c| c == "downloads"),
        "desktop" | "documents" => safe_categories.iter().any(|c| c == "documents"),
        _ => false,
    };
    total += files
        .iter()
        .filter(|f| files_category_matches(&f.root) && !is_excluded(&f.path))
        .map(|f| f.size_bytes)
        .sum::<u64>();

    total
}

fn send_notification(low_space: bool, free_bytes: u64, reclaimable_bytes: u64) -> bool {
    let gb = |bytes: u64| bytes as f64 / 1_000_000_000.0;
    let (title, body, route) = if low_space {
        (
            "Mac Storage Manager",
            format!("Your Mac has only {:.0} GB free. Review storage recommendations.", gb(free_bytes)),
            "/dashboard",
        )
    } else {
        (
            "Mac Storage Manager",
            format!("{:.1} GB can be reviewed for cleanup.", gb(reclaimable_bytes)),
            "/cleanup",
        )
    };

    let sent = native_notifications::send(title, &body, route);
    if sent {
        log::info!("[background-scan] notification sent: {body}");
    } else {
        log::warn!("[background-scan] notification submission did not confirm success");
    }
    sent
}
