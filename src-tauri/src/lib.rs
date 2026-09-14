mod applications;
mod auto_clean;
mod background;
mod browsers;
mod commands;
mod dedup;
mod developer;
mod disk;
mod dto;
mod native_notifications;
mod scanner;
mod schedule;
mod state;
mod trash;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Headless mode: launchd invokes this same binary with this flag (see
    // schedule.rs). No window, no webview — just a scan + maybe a
    // notification, then exit. Checked before touching `tauri::Builder` at
    // all, since `Builder::build()` alone never creates windows or runs
    // `.setup()` (both happen only once the event loop starts via `.run()`
    // — verified by reading tauri's app.rs), but `.run()` itself would
    // block waiting for window-close/quit, which never comes here.
    // `background::run()` needs no `tauri::Context`/`AppHandle` at all —
    // notifications go through `native_notifications::send`, which talks to
    // `UNUserNotificationCenter` directly — so `tauri::generate_context!()`
    // (which can only be invoked once per binary) is only ever called below,
    // in the one branch that actually needs it.
    if std::env::args().any(|a| a == "--background-scan") {
        // `--dry-run` runs the exact same scan + auto-clean eligibility
        // pipeline but never calls trash — see background.rs and
        // auto_clean.rs. A legitimate, permanent internal tool (not a
        // temporary test hook), used to validate the policy on a real Mac
        // before ever letting it delete anything unattended.
        let dry_run = std::env::args().any(|a| a == "--dry-run");
        background::run(dry_run);
        return;
    }

    // Read-only diagnostic: prints this bundle's real, current
    // UNAuthorizationStatus and exits. See native_notifications.rs's
    // `print_authorization_status` doc comment for why this exists instead
    // of guessing from system databases.
    if std::env::args().any(|a| a == "--check-notification-permission") {
        native_notifications::print_authorization_status();
        return;
    }

    // Diagnostic: sends one real test notification through the exact same
    // `native_notifications::send` used by real scheduled runs and prints
    // whether it reported success — see native_notifications.rs.
    if std::env::args().any(|a| a == "--send-test-notification") {
        native_notifications::send_test_notification();
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Registers this process as the UNUserNotificationCenter
            // delegate so a notification click — whether this app was
            // already running or just got launched by the click itself —
            // is resolved to an in-app route. See native_notifications.rs
            // for why tauri-plugin-notification alone can't do this.
            native_notifications::install_delegate(app.handle().clone());
            native_notifications::request_authorization();
            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_system_overview,
            commands::check_path_access,
            commands::reveal_in_finder,
            commands::open_full_disk_access_settings,
            commands::run_full_scan,
            commands::trash_items,
            commands::get_app_state,
            commands::save_app_state,
            commands::install_schedule,
            commands::remove_schedule,
            commands::get_schedule_status,
            commands::heal_schedule_path,
            commands::get_notification_permission_state,
            commands::request_notification_permission,
            commands::open_notification_settings,
            commands::get_pending_notification_route,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
