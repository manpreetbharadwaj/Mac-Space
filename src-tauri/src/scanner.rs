use crate::dto::{ScanWarningDto, ScannedFileDto};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

/// Directory names we never descend into: they belong to other scan categories
/// (developer tooling) or are simply not useful for a storage-cleanup listing.
const SKIP_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    ".Trash",
    "Library",
    ".cache",
];

pub fn system_time_to_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

/// Recursively sums the size of every file under `path`. Permission errors on
/// individual subdirectories are skipped rather than aborting the whole walk.
pub fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    WalkDir::new(path)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

/// "accessible" | "denied" | "not-found"
pub fn path_access_state(path: &Path) -> &'static str {
    if !path.exists() {
        return "not-found";
    }
    match std::fs::read_dir(path) {
        Ok(_) => "accessible",
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => "denied",
        Err(_) => "denied",
    }
}

/// Walks `root` up to `max_depth` levels, returning every file at least
/// `min_size_bytes` large. Skips directories in `SKIP_DIR_NAMES` and any
/// individual entry that errors (permission issues, broken symlinks, etc).
pub fn scan_candidate_files(
    root: &Path,
    root_label: &str,
    max_depth: usize,
    min_size_bytes: u64,
    max_results: usize,
) -> (Vec<ScannedFileDto>, Option<ScanWarningDto>) {
    if !root.exists() {
        return (
            Vec::new(),
            Some(ScanWarningDto {
                path: root.to_string_lossy().to_string(),
                message: "Location not found on this Mac.".to_string(),
            }),
        );
    }

    if std::fs::read_dir(root).is_err() {
        return (
            Vec::new(),
            Some(ScanWarningDto {
                path: root.to_string_lossy().to_string(),
                message: "Permission denied — this Mac may require Full Disk Access to read this location.".to_string(),
            }),
        );
    }

    let mut results = Vec::new();

    let walker = WalkDir::new(root)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|entry| {
            if entry.file_type().is_dir() {
                let name = entry.file_name().to_string_lossy();
                return !SKIP_DIR_NAMES.contains(&name.as_ref());
            }
            true
        });

    for entry in walker {
        if results.len() >= max_results {
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() < min_size_bytes {
            continue;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let extension = path
            .extension()
            .map(|ext| ext.to_string_lossy().to_lowercase());

        results.push(ScannedFileDto {
            name,
            path: path.to_string_lossy().to_string(),
            size_bytes: meta.len(),
            modified_ms: meta.modified().ok().and_then(system_time_to_ms),
            accessed_ms: meta.accessed().ok().and_then(system_time_to_ms),
            extension,
            root: root_label.to_string(),
            duplicate_group: None,
        });
    }

    (results, None)
}

/// For directories like `~/Library/Caches` or `~/Library/Logs` that hold
/// thousands of small files across hundreds of per-app subfolders: rather than
/// listing every file, this sizes each *top-level* entry as one unit (e.g. one
/// row per app's cache folder) and returns the largest ones.
pub fn scan_top_level_sizes(
    root: &Path,
    root_label: &str,
    min_size_bytes: u64,
    max_results: usize,
) -> (Vec<ScannedFileDto>, Option<ScanWarningDto>) {
    if !root.exists() {
        return (
            Vec::new(),
            Some(ScanWarningDto {
                path: root.to_string_lossy().to_string(),
                message: "Location not found on this Mac.".to_string(),
            }),
        );
    }

    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => {
            return (
                Vec::new(),
                Some(ScanWarningDto {
                    path: root.to_string_lossy().to_string(),
                    message: "Permission denied — this Mac may require Full Disk Access to read this location.".to_string(),
                }),
            );
        }
    };

    let mut results = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };
        let size_bytes = if file_type.is_dir() {
            dir_size(&path)
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };
        if size_bytes < min_size_bytes {
            continue;
        }
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(system_time_to_ms);

        results.push(ScannedFileDto {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            size_bytes,
            modified_ms,
            accessed_ms: None,
            extension: None,
            root: root_label.to_string(),
            duplicate_group: None,
        });
    }

    results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    results.truncate(max_results);
    (results, None)
}
