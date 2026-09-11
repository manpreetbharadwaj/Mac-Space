use crate::dto::AppItemDto;
use crate::scanner::dir_size;
use std::path::{Path, PathBuf};
use std::process::Command;

const APPLICATION_ROOTS: &[&str] = &["/Applications"];

fn read_version_and_bundle_id(app_path: &Path) -> (Option<String>, Option<String>) {
    let plist_path = app_path.join("Contents/Info.plist");
    let Ok(value) = plist::Value::from_file(&plist_path) else {
        return (None, None);
    };
    let dict = value.as_dictionary();
    let version = dict
        .and_then(|d| d.get("CFBundleShortVersionString"))
        .and_then(|v| v.as_string())
        .map(|s| s.to_string());
    let bundle_id = dict
        .and_then(|d| d.get("CFBundleIdentifier"))
        .and_then(|v| v.as_string())
        .map(|s| s.to_string());
    (version, bundle_id)
}

/// Asks Spotlight (via `mdls`) for the last time this app was opened. If
/// Spotlight has no record — common for apps that were just installed, or on
/// a machine with Spotlight indexing disabled — this returns None. We never
/// fabricate a fallback date; the UI is expected to show "Unknown" instead.
fn read_last_used_ms(app_path: &Path) -> Option<u64> {
    let path_str = app_path.to_str()?;
    let output = Command::new("mdls")
        .args(["-name", "kMDItemLastUsedDate", "-raw", path_str])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() || text == "(null)" {
        return None;
    }
    parse_mdls_date(&text)
}

fn parse_mdls_date(text: &str) -> Option<u64> {
    use chrono::DateTime;
    // mdls -raw prints dates like "2026-08-01 14:32:10 +0000"
    DateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S %z")
        .ok()
        .map(|dt| dt.timestamp_millis().max(0) as u64)
}

fn scan_root(root: &Path, items: &mut Vec<AppItemDto>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("app") {
            continue;
        }
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unknown".to_string());

        let (version, bundle_id) = read_version_and_bundle_id(&path);
        let size_bytes = dir_size(&path);
        let last_used_ms = read_last_used_ms(&path);

        items.push(AppItemDto {
            name,
            path: path.to_string_lossy().to_string(),
            size_bytes,
            version,
            bundle_id,
            last_used_ms,
        });
    }
}

pub fn scan_applications(home: &PathBuf) -> Vec<AppItemDto> {
    let mut items = Vec::new();

    for root in APPLICATION_ROOTS {
        scan_root(Path::new(root), &mut items);
    }
    scan_root(&home.join("Applications"), &mut items);

    items
}
