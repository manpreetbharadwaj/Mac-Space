use crate::scanner::dir_size;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Absolute system locations that must never be trashed, regardless of what
/// any caller claims about them. These are checked *in addition to* the
/// home-directory scoping below — belt and suspenders, since every path this
/// app legitimately scans is already under $HOME.
const PROTECTED_ABSOLUTE: &[&str] = &[
    "/",
    "/System",
    "/Library",
    "/Applications",
    "/usr",
    "/bin",
    "/sbin",
    "/private",
    "/Volumes",
];

/// Direct children of $HOME that must never be trashed *as a whole directory*
/// — cleaning something *inside* `~/Downloads` is fine; trashing
/// `~/Downloads` itself is not.
const PROTECTED_HOME_CHILDREN: &[&str] = &["Documents", "Desktop", "Downloads", "Library"];

/// Independent, native-side re-check of the same "this looks sensitive"
/// heuristic the frontend classifier uses (see classify.ts's
/// PROTECTED_KEYWORDS). Intentionally duplicated rather than shared: the
/// frontend is not trusted, so Rust re-derives this itself instead of taking
/// the frontend's word for it.
const SENSITIVE_KEYWORDS: &[&str] = &[
    "backup", "keychain", "1password", "wallet", ".key", "private key", "passwords",
];

fn looks_sensitive(path: &Path) -> bool {
    let haystack = path.to_string_lossy().to_lowercase();
    SENSITIVE_KEYWORDS.iter().any(|kw| haystack.contains(kw))
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashRequestItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    /// "green" | "orange" | "red" — sent for defense-in-depth only. The UI
    /// already prevents red items from ever being selectable, but Rust does
    /// not take that on faith: a request claiming `red` is hard-rejected here
    /// regardless of what the frontend intended.
    pub safety: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashResultItem {
    pub id: String,
    pub path: String,
    pub success: bool,
    pub failure_reason: Option<String>,
    pub bytes_expected: u64,
    pub bytes_processed: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashOperationResult {
    pub results: Vec<TrashResultItem>,
    pub overview_before: crate::dto::SystemOverviewDto,
    pub overview_after: crate::dto::SystemOverviewDto,
}

/// The single native authority on whether a path is allowed to be trashed.
/// Never trusts the caller: resolves symlinks/`..`/`.` via canonicalization,
/// then checks the *resolved* path against an absolute-path denylist, a
/// protected-home-children denylist, a sensitive-keyword re-check, and
/// finally a positive allowlist requiring the result to be strictly inside
/// the user's home directory. Every legitimate item this app ever scans is
/// under $HOME — nothing outside it should ever reach here, so the allowlist
/// is not just a formality.
pub fn validate_path(raw: &str, home: &Path) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("Empty path".to_string());
    }
    let requested = Path::new(raw);
    if !requested.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    let canonical = std::fs::canonicalize(requested)
        .map_err(|_| "File no longer exists at this path".to_string())?;

    let home_canonical = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());

    // Absolute system locations — checked against the resolved path.
    for protected in PROTECTED_ABSOLUTE {
        let protected_path = Path::new(protected);
        let protected_canonical =
            std::fs::canonicalize(protected_path).unwrap_or_else(|_| protected_path.to_path_buf());
        if canonical == protected_canonical {
            return Err(format!("Refusing to trash a protected system location: {protected}"));
        }
    }

    // $HOME itself.
    if canonical == home_canonical {
        return Err("Refusing to trash the home directory itself".to_string());
    }

    // Direct protected children of $HOME, as a whole directory.
    for child in PROTECTED_HOME_CHILDREN {
        let child_path = home.join(child);
        let child_canonical =
            std::fs::canonicalize(&child_path).unwrap_or_else(|_| child_path.clone());
        if canonical == child_canonical {
            return Err(format!("Refusing to trash a protected folder: ~/{child}"));
        }
    }

    // Positive allowlist: must land strictly inside $HOME after resolution.
    if canonical == home_canonical || !canonical.starts_with(&home_canonical) {
        return Err("Refusing to trash a path outside the user's home directory".to_string());
    }

    // Independent sensitive-content re-check (defense in depth vs. the frontend).
    if looks_sensitive(&canonical) {
        return Err("This item's path suggests it may contain sensitive data — protected by default".to_string());
    }

    Ok(canonical)
}

fn describe_trash_error(err: &trash::Error) -> String {
    match err {
        trash::Error::CouldNotAccess { target } => {
            format!("Could not access (permission denied or already gone): {target}")
        }
        trash::Error::TargetedRoot => "Refusing to trash a root folder".to_string(),
        trash::Error::CanonicalizePath { original } => {
            format!("Could not resolve path: {}", original.display())
        }
        trash::Error::Os { code, description } => {
            format!("macOS reported an error (code {code}): {description}")
        }
        other => format!("Could not move to Trash: {other}"),
    }
}

/// Validates, measures, and trashes a single item. Never panics; every
/// failure mode becomes a `TrashResultItem { success: false, .. }` so one bad
/// item never aborts the batch (see commands.rs::trash_items).
pub fn trash_single_item(home: &Path, item: &TrashRequestItem) -> TrashResultItem {
    if item.safety.eq_ignore_ascii_case("red") {
        return TrashResultItem {
            id: item.id.clone(),
            path: item.path.clone(),
            success: false,
            failure_reason: Some("Protected items cannot be cleaned".to_string()),
            bytes_expected: item.size_bytes,
            bytes_processed: 0,
        };
    }

    let validated = match validate_path(&item.path, home) {
        Ok(p) => p,
        Err(reason) => {
            return TrashResultItem {
                id: item.id.clone(),
                path: item.path.clone(),
                success: false,
                failure_reason: Some(reason),
                bytes_expected: item.size_bytes,
                bytes_processed: 0,
            }
        }
    };

    let bytes_processed = if validated.is_dir() {
        dir_size(&validated)
    } else {
        std::fs::metadata(&validated).map(|m| m.len()).unwrap_or(0)
    };

    match trash::delete(&validated) {
        Ok(()) => TrashResultItem {
            id: item.id.clone(),
            path: item.path.clone(),
            success: true,
            failure_reason: None,
            bytes_expected: item.size_bytes,
            bytes_processed,
        },
        Err(err) => TrashResultItem {
            id: item.id.clone(),
            path: item.path.clone(),
            success: false,
            failure_reason: Some(describe_trash_error(&err)),
            bytes_expected: item.size_bytes,
            bytes_processed: 0,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A fresh, uniquely-named scratch directory under the OS temp dir,
    /// standing in for "home" in tests that need a home-like boundary, and
    /// used directly as a throwaway fixture location otherwise. Removed by
    /// the caller (or left in temp if a test intentionally trashes it).
    ///
    /// Includes the process id alongside the counter so repeated `cargo
    /// test` invocations never collide with a still-existing directory (or
    /// symlink) left behind by an earlier run — a real bug this hit once:
    /// counter-only names restart at 0 every process, so two separate test
    /// runs would compute the *same* path and the second run's
    /// `symlink()` call would fail with `AlreadyExists` against a leftover
    /// from the first.
    fn scratch_dir(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("mac-storage-manager-test-{label}-{pid}-{n}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_root() {
        let home = scratch_dir("home-root");
        assert!(validate_path("/", &home).is_err());
    }

    #[test]
    fn rejects_absolute_system_paths() {
        let home = scratch_dir("home-sys");
        for p in ["/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/private", "/Volumes"] {
            let result = validate_path(p, &home);
            assert!(result.is_err(), "expected {p} to be rejected, got {result:?}");
        }
    }

    #[test]
    fn rejects_home_itself() {
        let home = scratch_dir("home-itself");
        assert!(validate_path(home.to_str().unwrap(), &home).is_err());
    }

    #[test]
    fn rejects_protected_home_children_as_whole_dirs() {
        let home = scratch_dir("home-children");
        for child in ["Documents", "Desktop", "Downloads", "Library"] {
            let child_path = home.join(child);
            fs::create_dir_all(&child_path).unwrap();
            let result = validate_path(child_path.to_str().unwrap(), &home);
            assert!(result.is_err(), "expected ~/{child} itself to be rejected, got {result:?}");
        }
    }

    #[test]
    fn allows_item_inside_protected_child() {
        let home = scratch_dir("home-inside");
        let target = home.join("Downloads").join("some-installer.dmg");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"fixture").unwrap();
        let result = validate_path(target.to_str().unwrap(), &home);
        assert!(result.is_ok(), "expected a file inside ~/Downloads to be allowed, got {result:?}");
        fs::remove_dir_all(home.join("Downloads")).ok();
    }

    #[test]
    fn rejects_path_outside_home() {
        let home = scratch_dir("home-outside");
        let outside = scratch_dir("outside-target");
        let result = validate_path(outside.to_str().unwrap(), &home);
        assert!(result.is_err(), "expected a path outside home to be rejected, got {result:?}");
    }

    #[test]
    fn rejects_relative_path() {
        let home = scratch_dir("home-relative");
        assert!(validate_path("Library/Caches/foo", &home).is_err());
    }

    #[test]
    fn rejects_missing_path() {
        let home = scratch_dir("home-missing");
        let missing = home.join("DeveloperTool").join("does-not-exist");
        let result = validate_path(missing.to_str().unwrap(), &home);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no longer exists"));
    }

    #[test]
    fn rejects_symlink_escaping_home() {
        let home = scratch_dir("home-symlink");
        let outside = scratch_dir("symlink-escape-target");
        fs::write(outside.join("secret.txt"), b"outside").unwrap();
        let link = home.join("escape-link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        // The symlink *inside* home resolves to a location outside home —
        // canonicalization must catch this, not just check the raw prefix.
        let result = validate_path(link.to_str().unwrap(), &home);
        assert!(result.is_err(), "expected a symlink resolving outside home to be rejected, got {result:?}");
    }

    #[test]
    fn rejects_sensitive_keyword_paths() {
        let home = scratch_dir("home-sensitive");
        let target = home.join("Library").join("Application Support").join("MobileSync").join("Backup");
        fs::create_dir_all(&target).unwrap();
        let result = validate_path(target.to_str().unwrap(), &home);
        assert!(result.is_err(), "expected a Backup-named path to be rejected, got {result:?}");
    }

    #[test]
    fn rejects_red_safety_regardless_of_path() {
        let home = scratch_dir("home-red");
        let target = home.join("Downloads").join("totally-normal-file.txt");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"fixture").unwrap();
        let item = TrashRequestItem {
            id: "1".into(),
            name: "totally-normal-file.txt".into(),
            path: target.to_str().unwrap().to_string(),
            size_bytes: 7,
            safety: "red".into(),
        };
        let result = trash_single_item(&home, &item);
        assert!(!result.success);
        assert_eq!(result.failure_reason.as_deref(), Some("Protected items cannot be cleaned"));
        assert!(target.exists(), "red item must not have been touched");
        fs::remove_dir_all(home.join("Downloads")).ok();
    }

    #[test]
    fn trashes_a_real_disposable_file() {
        let home = scratch_dir("home-real-file");
        let target = home.join("Downloads").join("disposable-test-file.txt");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        let content = b"disposable fixture content";
        fs::write(&target, content).unwrap();

        let item = TrashRequestItem {
            id: "2".into(),
            name: "disposable-test-file.txt".into(),
            path: target.to_str().unwrap().to_string(),
            size_bytes: content.len() as u64,
            safety: "green".into(),
        };
        let result = trash_single_item(&home, &item);
        assert!(result.success, "expected success, got {result:?}");
        assert!(!target.exists(), "file should have been moved out of its original location");
        assert_eq!(result.bytes_processed, content.len() as u64);
    }

    #[test]
    fn trashes_a_real_disposable_nested_directory() {
        let home = scratch_dir("home-real-dir");
        let target = home.join("Downloads").join("DisposableFixtureDir");
        fs::create_dir_all(target.join("nested").join("deeper")).unwrap();
        fs::write(target.join("a.txt"), b"aaaa").unwrap();
        fs::write(target.join("nested").join("b.txt"), b"bbbb").unwrap();
        fs::write(target.join("nested").join("deeper").join("c.txt"), b"cccccccc").unwrap();

        let item = TrashRequestItem {
            id: "3".into(),
            name: "DisposableFixtureDir".into(),
            path: target.to_str().unwrap().to_string(),
            size_bytes: 16,
            safety: "orange".into(),
        };
        let result = trash_single_item(&home, &item);
        assert!(result.success, "expected success, got {result:?}");
        assert!(!target.exists(), "directory should have been moved out of its original location");
        assert_eq!(result.bytes_processed, 16, "should measure actual current size, not just trust the caller");
    }

    #[test]
    fn missing_file_is_a_failure_not_a_panic() {
        let home = scratch_dir("home-missing-file");
        let target = home.join("Downloads").join("already-gone.txt");
        // Deliberately never created.
        let item = TrashRequestItem {
            id: "4".into(),
            name: "already-gone.txt".into(),
            path: target.to_str().unwrap().to_string(),
            size_bytes: 100,
            safety: "green".into(),
        };
        let result = trash_single_item(&home, &item);
        assert!(!result.success);
        assert!(result.failure_reason.is_some());
    }
}
