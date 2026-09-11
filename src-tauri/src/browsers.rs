use crate::dto::BrowserItemDto;
use crate::scanner::{dir_size, path_access_state};
use std::path::PathBuf;

struct BrowserDef {
    id: &'static str,
    name: &'static str,
    /// Fixed cache-only paths, relative to $HOME. Deliberately excludes any
    /// profile, cookie, password, bookmark, or history storage.
    cache_paths: &'static [&'static str],
}

const BROWSERS: &[BrowserDef] = &[
    BrowserDef {
        id: "safari",
        name: "Safari",
        cache_paths: &["Library/Caches/com.apple.Safari"],
    },
    BrowserDef {
        id: "chrome",
        name: "Chrome",
        cache_paths: &[
            "Library/Caches/Google/Chrome",
            "Library/Application Support/Google/Chrome/Default/Cache",
        ],
    },
    BrowserDef {
        id: "edge",
        name: "Microsoft Edge",
        cache_paths: &[
            "Library/Caches/Microsoft Edge",
            "Library/Application Support/Microsoft Edge/Default/Cache",
        ],
    },
];

/// Firefox profile folder names are randomized, so its cache path isn't fixed
/// like the others — we glob the Profiles directory for `*/cache2`.
fn firefox_cache_paths(home: &PathBuf) -> Vec<PathBuf> {
    let mut paths = vec![home.join("Library/Caches/Firefox")];
    let profiles_dir = home.join("Library/Application Support/Firefox/Profiles");
    if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
        for entry in entries.flatten() {
            let cache2 = entry.path().join("cache2");
            if cache2.exists() {
                paths.push(cache2);
            }
        }
    }
    paths
}

pub fn scan_browser_storage(home: &PathBuf) -> Vec<BrowserItemDto> {
    let mut items = Vec::new();

    for def in BROWSERS {
        let candidate_paths: Vec<PathBuf> = def.cache_paths.iter().map(|p| home.join(p)).collect();
        let any_exists = candidate_paths.iter().any(|p| p.exists());
        if !any_exists {
            continue; // browser likely not installed / never used
        }

        let cache_bytes: u64 = candidate_paths.iter().map(|p| dir_size(p)).sum();
        let accessible = candidate_paths
            .iter()
            .any(|p| path_access_state(p) == "accessible");
        let primary_path = candidate_paths
            .first()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        items.push(BrowserItemDto {
            browser_id: def.id.to_string(),
            name: def.name.to_string(),
            cache_bytes,
            accessible,
            cache_path: primary_path,
        });
    }

    let firefox_paths = firefox_cache_paths(home);
    if firefox_paths.iter().any(|p| p.exists()) {
        let cache_bytes: u64 = firefox_paths.iter().map(|p| dir_size(p)).sum();
        let accessible = firefox_paths
            .iter()
            .any(|p| path_access_state(p) == "accessible");
        items.push(BrowserItemDto {
            browser_id: "firefox".to_string(),
            name: "Firefox".to_string(),
            cache_bytes,
            accessible,
            cache_path: firefox_paths
                .first()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        });
    }

    items
}
