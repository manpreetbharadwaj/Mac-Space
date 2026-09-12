mod applications;
mod browsers;
mod commands;
mod dedup;
mod developer;
mod disk;
mod dto;
mod scanner;
mod trash;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_system_overview,
            commands::check_path_access,
            commands::reveal_in_finder,
            commands::open_full_disk_access_settings,
            commands::run_full_scan,
            commands::trash_items,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
