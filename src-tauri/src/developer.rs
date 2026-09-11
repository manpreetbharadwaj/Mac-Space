use crate::dto::DevItemDto;
use crate::scanner::{dir_size, system_time_to_ms};
use std::path::{Path, PathBuf};

struct DevPath {
    kind: &'static str,
    tool: &'static str,
    label: &'static str,
    relative: &'static str,
}

const KNOWN_PATHS: &[DevPath] = &[
    DevPath {
        kind: "xcode-derived-data",
        tool: "xcode",
        label: "Xcode DerivedData",
        relative: "Library/Developer/Xcode/DerivedData",
    },
    DevPath {
        kind: "xcode-archives",
        tool: "xcode",
        label: "Xcode Archives",
        relative: "Library/Developer/Xcode/Archives",
    },
    DevPath {
        kind: "xcode-device-support-ios",
        tool: "xcode",
        label: "iOS Device Support",
        relative: "Library/Developer/Xcode/iOS DeviceSupport",
    },
    DevPath {
        kind: "xcode-device-support-watchos",
        tool: "xcode",
        label: "watchOS Device Support",
        relative: "Library/Developer/Xcode/watchOS DeviceSupport",
    },
    DevPath {
        kind: "xcode-simulator-caches",
        tool: "xcode",
        label: "Simulator Caches",
        relative: "Library/Developer/CoreSimulator/Caches",
    },
    DevPath {
        kind: "xcode-simulator-devices",
        tool: "xcode",
        label: "Simulator Devices",
        relative: "Library/Developer/CoreSimulator/Devices",
    },
    DevPath {
        kind: "npm-cache",
        tool: "node",
        label: "npm cache",
        relative: ".npm/_cacache",
    },
    DevPath {
        kind: "yarn-cache",
        tool: "node",
        label: "Yarn cache",
        relative: "Library/Caches/Yarn",
    },
    DevPath {
        kind: "gradle-caches",
        tool: "android",
        label: "Gradle caches",
        relative: ".gradle/caches",
    },
    DevPath {
        kind: "android-avd",
        tool: "android",
        label: "Android emulator images",
        relative: ".android/avd",
    },
    DevPath {
        kind: "cocoapods-cache",
        tool: "cocoapods",
        label: "CocoaPods cache",
        relative: "Library/Caches/CocoaPods",
    },
];

const PNPM_STORE_CANDIDATES: &[&str] = &[
    "Library/pnpm/store",
    ".local/share/pnpm/store",
    ".pnpm-store",
];

fn make_item(home: &Path, dev: &DevPath) -> Option<DevItemDto> {
    let path = home.join(dev.relative);
    if !path.exists() {
        return None;
    }
    let size_bytes = dir_size(&path);
    if size_bytes == 0 {
        return None;
    }
    let modified_ms = std::fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(system_time_to_ms);

    Some(DevItemDto {
        kind: dev.kind.to_string(),
        tool: dev.tool.to_string(),
        label: dev.label.to_string(),
        path: path.to_string_lossy().to_string(),
        size_bytes,
        modified_ms,
    })
}

fn find_pnpm_store(home: &Path) -> Option<DevItemDto> {
    for candidate in PNPM_STORE_CANDIDATES {
        let path = home.join(candidate);
        if path.exists() {
            let size_bytes = dir_size(&path);
            if size_bytes == 0 {
                continue;
            }
            let modified_ms = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(system_time_to_ms);
            return Some(DevItemDto {
                kind: "pnpm-store".to_string(),
                tool: "node".to_string(),
                label: "pnpm store".to_string(),
                path: path.to_string_lossy().to_string(),
                size_bytes,
                modified_ms,
            });
        }
    }
    None
}

/// Best-effort Metro (React Native bundler) cache detection. Metro writes its
/// cache under the OS temp directory with a `metro-*`-prefixed name, so unlike
/// the other tools this location isn't fixed — we scan TMPDIR for matches.
fn find_metro_cache() -> Option<DevItemDto> {
    let tmp = std::env::temp_dir();
    let entries = std::fs::read_dir(&tmp).ok()?;
    let mut total = 0u64;
    let mut found_any = false;
    let mut newest_modified: Option<u64> = None;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("metro-") {
            found_any = true;
            total += dir_size(&entry.path());
            if let Ok(meta) = entry.metadata() {
                if let Some(ms) = meta.modified().ok().and_then(system_time_to_ms) {
                    newest_modified = Some(newest_modified.map_or(ms, |cur| cur.max(ms)));
                }
            }
        }
    }

    if !found_any || total == 0 {
        return None;
    }

    Some(DevItemDto {
        kind: "metro-cache".to_string(),
        tool: "node".to_string(),
        label: "Metro bundler cache".to_string(),
        path: tmp.to_string_lossy().to_string(),
        size_bytes: total,
        modified_ms: newest_modified,
    })
}

pub fn scan_developer_storage(home: &PathBuf) -> Vec<DevItemDto> {
    let mut items: Vec<DevItemDto> = KNOWN_PATHS
        .iter()
        .filter_map(|dev| make_item(home, dev))
        .collect();

    if let Some(item) = find_pnpm_store(home) {
        items.push(item);
    }
    if let Some(item) = find_metro_cache() {
        items.push(item);
    }

    items
}
