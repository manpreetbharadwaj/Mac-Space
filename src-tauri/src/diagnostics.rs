//! Launch-time diagnostics for shipped (release) builds: where the app is
//! running from, a crash log that exists even if the normal logger never
//! started, and one startup banner line so a "won't open" report can be
//! diagnosed from `~/Library/Logs/com.macstoragemanager.app/`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const LOG_DIR_NAME: &str = "com.macstoragemanager.app";
const CRASH_LOG_NAME: &str = "startup-crash.log";
const CRASH_LOG_MAX_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallLocation {
    /// Inside a real `.app` bundle at a normal, persistent path.
    Stable,
    /// macOS App Translocation: a quarantined app launched from Downloads or
    /// a disk image runs from a randomized, read-only, per-launch mount.
    Translocated,
    /// Running straight off a mounted volume (typically the .dmg itself).
    Volume,
    /// Not inside a `.app` bundle at all (bare binary: dev build or a copied executable).
    NotABundle,
}

impl InstallLocation {
    /// A path that will not exist (or will change) after a relaunch or an
    /// eject — must never be written into a LaunchAgent.
    pub fn is_ephemeral(self) -> bool {
        matches!(self, InstallLocation::Translocated | InstallLocation::Volume)
    }
}

pub fn classify_install_location(exe: &Path) -> InstallLocation {
    let p = exe.to_string_lossy();
    if p.contains("/AppTranslocation/") {
        InstallLocation::Translocated
    } else if p.starts_with("/Volumes/") {
        InstallLocation::Volume
    } else if !p.contains(".app/Contents/MacOS/") {
        InstallLocation::NotABundle
    } else {
        InstallLocation::Stable
    }
}

pub fn current_install_location() -> InstallLocation {
    match std::env::current_exe() {
        Ok(exe) => classify_install_location(&exe),
        Err(_) => InstallLocation::NotABundle,
    }
}

fn log_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Library/Logs").join(LOG_DIR_NAME))
}

fn append_crash_log(message: &str) {
    let Some(dir) = log_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(CRASH_LOG_NAME);
    if fs::metadata(&path).map(|m| m.len() > CRASH_LOG_MAX_BYTES).unwrap_or(false) {
        let _ = fs::write(&path, b"");
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(file, "[{stamp}] {message}");
    }
}

/// Records any panic to `startup-crash.log` *before* delegating to the
/// default hook. Independent of `tauri-plugin-log`, so it still captures a
/// failure that happens before the logger is initialized.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        append_crash_log(&format!("PANIC: {info}"));
        previous(info);
    }));
}

pub fn log_startup_banner(app_version: &str) {
    let exe = std::env::current_exe().ok();
    let location = exe.as_deref().map(classify_install_location).unwrap_or(InstallLocation::NotABundle);
    let os_version = sysinfo::System::os_version().unwrap_or_else(|| "unknown".to_string());
    log::info!(
        "Mac Storage Manager {app_version} starting: arch={}, macOS={os_version}, install_location={location:?}, exe={}",
        std::env::consts::ARCH,
        exe.as_deref().map(|p| p.display().to_string()).unwrap_or_else(|| "unknown".to_string()),
    );
    match location {
        InstallLocation::Translocated | InstallLocation::Volume => log::warn!(
            "Running from a temporary location (disk image or Downloads). Move the app to /Applications and reopen it; scheduled scans stay disabled until then."
        ),
        InstallLocation::NotABundle => log::info!("Not running from an .app bundle (development build)."),
        InstallLocation::Stable => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(p: &str) -> InstallLocation {
        classify_install_location(Path::new(p))
    }

    #[test]
    fn applications_folder_is_stable() {
        assert_eq!(classify("/Applications/Mac Storage Manager.app/Contents/MacOS/app"), InstallLocation::Stable);
        assert_eq!(classify("/Users/x/Applications/Mac Storage Manager.app/Contents/MacOS/app"), InstallLocation::Stable);
    }

    #[test]
    fn translocated_path_is_ephemeral() {
        let p = "/private/var/folders/2f/abc/T/AppTranslocation/6F1D/d/Mac Storage Manager.app/Contents/MacOS/app";
        assert_eq!(classify(p), InstallLocation::Translocated);
        assert!(classify(p).is_ephemeral());
    }

    #[test]
    fn disk_image_volume_is_ephemeral() {
        let p = "/Volumes/Mac Storage Manager/Mac Storage Manager.app/Contents/MacOS/app";
        assert_eq!(classify(p), InstallLocation::Volume);
        assert!(classify(p).is_ephemeral());
    }

    #[test]
    fn bare_binaries_are_not_bundles_and_not_ephemeral() {
        for p in ["/Users/x/proj/src-tauri/target/release/app", "/Users/x/proj/src-tauri/target/debug/app"] {
            assert_eq!(classify(p), InstallLocation::NotABundle);
            assert!(!classify(p).is_ephemeral());
        }
    }
}
