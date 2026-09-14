//! Shared persisted app state (settings + schedule + history + scan events),
//! stored as one JSON file under Application Support so it's readable and
//! writable both by the normal running app AND by the headless
//! `--background-scan` invocation (see background.rs) — a plain OS process
//! with no WebView, so it can't use the frontend's localStorage.
//!
//! Deliberately loose: this stores/returns `serde_json::Value` rather than
//! fully-typed Rust structs mirroring every TS type. The frontend
//! (src/types/index.ts) remains the single source of truth for the shape of
//! settings/schedule/history — Rust only reads/writes the handful of fields
//! the background job actually needs (schedule.*, settings.notificationsEnabled,
//! settings.exclusions), and passes everything else through untouched. This
//! avoids two parallel type definitions drifting out of sync.

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

const STATE_FILE_NAME: &str = "state.json";

/// `~/Library/Application Support/com.macstoragemanager.app/` — matches the
/// platform convention Tauri's own path resolver would give for
/// `app_data_dir()`, computed manually so it works identically whether
/// called from the running app or the headless background binary (which has
/// no AppHandle to ask).
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("com.macstoragemanager.app"))
}

/// Debug-only test isolation: when set, reads/writes go to this path instead
/// of the real state.json, so an auto-clean fixture test (see
/// background.rs's `test_home_override`) can never read or corrupt the
/// user's actual persisted settings/schedule/history. Compiled out entirely
/// in release builds, same reasoning as `test_home_override`.
#[cfg(debug_assertions)]
fn state_file_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("MSM_TEST_STATE_PATH") {
        return Some(PathBuf::from(path));
    }
    app_data_dir().map(|d| d.join(STATE_FILE_NAME))
}
#[cfg(not(debug_assertions))]
fn state_file_path() -> Option<PathBuf> {
    app_data_dir().map(|d| d.join(STATE_FILE_NAME))
}

/// Returns `json!({})` if the file doesn't exist yet or fails to parse —
/// callers should treat missing fields as "use the default," never panic.
pub fn load_state() -> Value {
    let Some(path) = state_file_path() else {
        return json!({});
    };
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
            log::warn!("state.json exists but failed to parse ({e}); using empty state");
            json!({})
        }),
        Err(_) => json!({}),
    }
}

pub fn save_state(state: &Value) -> Result<(), String> {
    // Bug fixed here (caught live, during this phase's own fixture testing):
    // this used to independently recompute `app_data_dir().join(...)`
    // instead of going through `state_file_path()`, so `MSM_TEST_STATE_PATH`
    // silently only redirected *reads* — a real auto-clean fixture test
    // still wrote its result into the actual user's real state.json. Now
    // both load and save go through the exact same path resolution.
    let path = state_file_path().ok_or_else(|| "Could not determine Application Support directory".to_string())?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| e.to_string())
}

// --- Small typed helpers for the specific fields background.rs/schedule.rs need ---

pub fn get_bool(state: &Value, path: &[&str], default: bool) -> bool {
    get_path(state, path).and_then(Value::as_bool).unwrap_or(default)
}

pub fn get_str<'a>(state: &'a Value, path: &[&str]) -> Option<&'a str> {
    get_path(state, path).and_then(Value::as_str)
}

pub fn get_f64(state: &Value, path: &[&str], default: f64) -> f64 {
    get_path(state, path).and_then(Value::as_f64).unwrap_or(default)
}

pub fn get_str_array(state: &Value, path: &[&str]) -> Vec<String> {
    get_path(state, path)
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn get_path<'a>(state: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = state;
    for key in path {
        cur = cur.get(key)?;
    }
    Some(cur)
}

/// Sets a nested field, creating intermediate objects as needed. Used by the
/// background job to update schedule.lastRunAt/nextRunAt without disturbing
/// anything else in the blob (settings, history, etc. pass through as-is).
pub fn set_path(state: &mut Value, path: &[&str], value: Value) {
    let mut cur = state;
    for key in &path[..path.len() - 1] {
        if !cur.is_object() {
            *cur = json!({});
        }
        cur = cur.as_object_mut().unwrap().entry(key.to_string()).or_insert(json!({}));
    }
    if let Some(obj) = cur.as_object_mut() {
        obj.insert(path[path.len() - 1].to_string(), value);
    }
}

/// Appends an entry to a top-level array field (e.g. "scanEvents"),
/// creating it if absent, and caps it at `max_len` most-recent entries.
pub fn push_capped(state: &mut Value, field: &str, entry: Value, max_len: usize) {
    if !state.is_object() {
        *state = json!({});
    }
    let obj = state.as_object_mut().unwrap();
    let arr = obj.entry(field.to_string()).or_insert_with(|| json!([]));
    if let Some(arr) = arr.as_array_mut() {
        arr.insert(0, entry);
        arr.truncate(max_len);
    }
}

/// Regression coverage for a real bug that shipped and was caught live
/// (during auto-clean fixture testing): `save_state` used to independently
/// recompute `app_data_dir().join(...)` instead of going through
/// `state_file_path()`, so setting `MSM_TEST_STATE_PATH` silently redirected
/// *reads* only — a save still landed in the user's real state.json. These
/// tests hash the real file before and after every override-path operation
/// so that regression can never silently return unnoticed.
///
/// All tests here share one process-wide env var (`MSM_TEST_STATE_PATH`), so
/// they're serialized through `ENV_MUTEX` — `cargo test` runs tests in
/// parallel by default, and two tests racing to set/unset the same env var
/// would corrupt each other's results (not a hypothetical: this is a
/// standard, necessary pattern for any Rust test touching process env vars).
#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    static ENV_MUTEX: Mutex<()> = Mutex::new(());
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn hash_file(path: &PathBuf) -> Option<Vec<u8>> {
        fs::read(path).ok().map(|bytes| Sha256::digest(&bytes).to_vec())
    }

    fn real_state_path() -> PathBuf {
        app_data_dir().expect("home directory must be resolvable in test environment").join(STATE_FILE_NAME)
    }

    fn scratch_override_path(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("mac-storage-manager-state-test-{label}-{}-{n}.json", std::process::id()))
    }

    /// RAII guard: sets `MSM_TEST_STATE_PATH` for the duration of a test and
    /// always clears it on drop (including on panic/early return), so one
    /// failing test can never leak the override into an unrelated later one.
    struct OverrideGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        path: PathBuf,
    }
    impl OverrideGuard {
        fn set(path: PathBuf) -> Self {
            let lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("MSM_TEST_STATE_PATH", &path);
            Self { _lock: lock, path }
        }
    }
    impl Drop for OverrideGuard {
        fn drop(&mut self) {
            std::env::remove_var("MSM_TEST_STATE_PATH");
            let _ = fs::remove_file(&self.path);
        }
    }

    #[test]
    fn state_file_path_uses_override_when_set() {
        let scratch = scratch_override_path("path-resolution");
        let _guard = OverrideGuard::set(scratch.clone());
        assert_eq!(state_file_path(), Some(scratch));
    }

    #[test]
    fn state_file_path_falls_back_to_real_path_when_unset() {
        let lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("MSM_TEST_STATE_PATH");
        assert_eq!(state_file_path(), Some(real_state_path()));
        drop(lock);
    }

    #[test]
    fn load_and_save_go_to_the_override_path_and_never_touch_the_real_file() {
        let real_path = real_state_path();
        let before_hash = hash_file(&real_path);

        let scratch = scratch_override_path("load-save");
        let _guard = OverrideGuard::set(scratch.clone());

        let payload = json!({ "marker": "state-rs-regression-test", "schedule": { "mode": "reminder" } });
        save_state(&payload).expect("save_state with an override path must succeed");

        // 1. The override path actually received the write.
        assert!(scratch.exists(), "expected save_state to write to the override path, not the real one");
        let loaded = load_state();
        assert_eq!(loaded, payload, "load_state must read back exactly what save_state wrote, from the override path");

        // 2. The real file is byte-for-byte unchanged (hash comparison, not
        // just "still exists" — this is the exact check that would have
        // caught the original bug immediately).
        let after_hash = hash_file(&real_path);
        assert_eq!(before_hash, after_hash, "the real state.json must be byte-for-byte unchanged after an override-path save");
    }

    #[test]
    fn multiple_read_write_cycles_stay_isolated_to_the_override_path() {
        let real_path = real_state_path();
        let before_hash = hash_file(&real_path);

        let scratch = scratch_override_path("multi-cycle");
        let _guard = OverrideGuard::set(scratch.clone());

        for i in 0..5 {
            let payload = json!({ "cycle": i, "schedule": { "lastRunAt": format!("run-{i}") } });
            save_state(&payload).expect("save_state must succeed on every cycle");
            let loaded = load_state();
            assert_eq!(loaded, payload, "cycle {i}: load must reflect exactly that cycle's save, not a stale or mixed value");
        }

        let after_hash = hash_file(&real_path);
        assert_eq!(before_hash, after_hash, "5 override-path read/write cycles must never touch the real state.json");
    }

    /// The release-mode guarantee itself (that `MSM_TEST_STATE_PATH` is
    /// unavailable at all, not merely unused) is enforced by the
    /// `#[cfg(not(debug_assertions))]` variant of `state_file_path` a few
    /// lines above this test module — `cargo test` always builds with
    /// `debug_assertions` on, so no unit test in this binary can execute
    /// that cfg branch to prove it at runtime. That branch is intentionally
    /// simple enough to verify by inspection (it does not reference the env
    /// var at all, so there is nothing for a release binary to read), and it
    /// was additionally verified empirically against the real compiled
    /// release binary: `MSM_TEST_STATE_PATH` set to a scratch path while
    /// running `target/release/app` still wrote to the real
    /// `~/Library/Application Support/com.macstoragemanager.app/state.json`
    /// (see the phase's live verification report).
    #[test]
    fn release_mode_cfg_branch_does_not_reference_the_override_env_var() {
        let source = include_str!("state.rs");
        let release_branch_start = source.find("#[cfg(not(debug_assertions))]\nfn state_file_path").expect("release-mode state_file_path variant must exist");
        let release_branch = &source[release_branch_start..];
        let release_branch_end = release_branch.find("\n}\n").map(|i| i + 3).unwrap_or(release_branch.len());
        let release_branch = &release_branch[..release_branch_end];
        assert!(
            !release_branch.contains("MSM_TEST_STATE_PATH"),
            "the release-mode state_file_path variant must never reference the test override env var:\n{release_branch}"
        );
    }
}
