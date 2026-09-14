//! Native, unattended-cleanup eligibility policy — the decision layer that
//! makes "Auto-clean Safe items" real. This is deliberately NOT the same
//! thing as the frontend's green/orange/red classifier (`classify.ts`):
//! that lives in the WebView, is unreachable from the headless
//! `--background-scan` process, and — more importantly — "safe enough for a
//! human to approve after a glance" is not the same bar as "safe enough to
//! delete with nobody watching." This module is a second, much stricter,
//! independent gate that only the native side evaluates.
//!
//! # Design
//!
//! The frontend's `safety: "green"` is never trusted as proof of anything
//! here (background.rs doesn't even pass it in — this module recomputes
//! eligibility from raw scan data: `kind`, `path`, exclusions). Everything
//! not explicitly allowlisted below is rejected, and every allowlisted item
//! still has to pass the exact same `trash::validate_path`/
//! `trash::trash_single_item` gauntlet manual cleanup uses (canonicalization,
//! home-directory scoping, protected-path denylist, sensitive-keyword
//! re-check, symlink-escape rejection) — this module is an *additional*
//! filter stacked in front of that, never a replacement for it.
//!
//! # Allowlist
//!
//! Only six developer-tool cache kinds, matched by `DevItemDto.kind`
//! *and* independently re-verified against the exact relative path
//! `developer.rs` is known to produce for that kind (belt and suspenders —
//! a `kind` string alone is just a label; the path shape is re-checked too).
//! Deliberately excluded from v1, with reasons:
//!
//! - `xcode-archives`, `xcode-simulator-devices`, `android-avd`: these hold
//!   real state (re-signable archives, installed test-app data), not pure
//!   regenerable cache — already `orange` even in the frontend classifier.
//! - `xcode-device-support-ios`/`-watchos`, `xcode-simulator-caches`: `green`
//!   in the frontend classifier, but not on this list — kept out for v1
//!   specifically because the task scoping this feature named an explicit,
//!   narrow allowlist rather than "everything green," and per-item risk
//!   review of these wasn't part of that scoping.
//! - `metro-cache`: **excluded for a concrete, discovered reason, not
//!   caution alone.** `developer.rs::find_metro_cache()` reports the path as
//!   `std::env::temp_dir()` itself (the whole OS temp directory), not a
//!   scoped `metro-*` subfolder — trashing `item.path` for this kind would
//!   mean trashing all of TMPDIR. `trash::validate_path`'s home-directory
//!   allowlist would likely reject it anyway (macOS's temp dir is under
//!   `/var/folders`, not `$HOME`), but "probably caught downstream" is not
//!   the bar here — it's excluded at the policy layer, on purpose.
//! - Browser cache: excluded per explicit scope for this version — its
//!   classifier (`classifyBrowserCleanupItems`) is the one frontend
//!   classifier that skips the sensitivity keyword check entirely, so it
//!   does not meet "protected by the same native sensitivity checks."
//! - Anything else (unknown kind, files, applications): rejected by default.

use crate::dto::DevItemDto;
use crate::trash::looks_sensitive;
use std::path::Path;

/// Bump this if the allowlist or its checks change in a way that meaningfully
/// changes what gets deleted unattended — background.rs refuses to run
/// auto-clean unless the persisted consent version is >= this, so a policy
/// change can require re-consent (see schedule.autoCleanConsentVersion).
pub const POLICY_VERSION: u32 = 1;

/// Below this, a scheduled run scans and records what it found but never
/// moves anything — not worth the risk/activity for a trivial amount.
/// Chosen (not the task's other suggested value, 500MB) as the more
/// conservative end of the requested range, since this is the feature's
/// first unattended-deletion release.
pub const MIN_ELIGIBLE_BYTES: u64 = 1_000_000_000; // 1 GB

/// Hard ceiling per scheduled run. If more eligible data exists than this,
/// the largest-first eligible items are cleaned up to the cap and the rest
/// is deliberately left for a later run or manual review — never exceeded.
pub const MAX_BYTES_PER_RUN: u64 = 10_000_000_000; // 10 GB

/// Hard item-count ceiling per run, independent of the byte cap (a great
/// many small items could stay under the byte cap while still being an
/// unexpectedly large batch of filesystem operations to perform unattended).
pub const MAX_ITEMS_PER_RUN: usize = 50;

/// (kind, expected relative path suffix under $HOME). Intentionally a small,
/// self-contained, independently-auditable copy of the same six locations
/// `developer.rs::KNOWN_PATHS`/`PNPM_STORE_CANDIDATES` already encode — not
/// wired to that table directly, so this policy's allowlist can be read and
/// reviewed in one place without cross-referencing another module, and so a
/// future change to `developer.rs`'s paths doesn't silently widen what this
/// policy accepts. pnpm has three possible store locations depending on how
/// it was installed, so it gets its own small list.
const ALLOWED_SUFFIXES: &[(&str, &str)] = &[
    ("xcode-derived-data", "Library/Developer/Xcode/DerivedData"),
    ("npm-cache", ".npm/_cacache"),
    ("yarn-cache", "Library/Caches/Yarn"),
    ("gradle-caches", ".gradle/caches"),
    ("cocoapods-cache", "Library/Caches/CocoaPods"),
];
const PNPM_KIND: &str = "pnpm-store";
const PNPM_SUFFIXES: &[&str] = &["Library/pnpm/store", ".local/share/pnpm/store", ".pnpm-store"];

#[derive(Debug, Clone)]
pub struct Candidate {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct Skip {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct EligibilityReport {
    pub eligible: Vec<Candidate>,
    pub eligible_bytes: u64,
    pub skipped: Vec<Skip>,
}

fn is_excluded(path: &str, exclusions: &[String]) -> bool {
    exclusions.iter().any(|ex| path == ex || path.starts_with(&format!("{ex}/")))
}

/// Structural re-check: does this item's actual path end with the exact
/// relative suffix we independently know that `kind` should have, under the
/// given home directory? A `kind` string is just a label a scanner attached;
/// this confirms the path shape backs it up before it's ever treated as
/// eligible.
fn matches_known_shape(home: &Path, kind: &str, path: &str) -> bool {
    let candidate = Path::new(path);
    if kind == PNPM_KIND {
        return PNPM_SUFFIXES.iter().any(|suffix| candidate == home.join(suffix));
    }
    ALLOWED_SUFFIXES
        .iter()
        .any(|(k, suffix)| *k == kind && candidate == home.join(suffix))
}

fn is_allowed_kind(kind: &str) -> bool {
    kind == PNPM_KIND || ALLOWED_SUFFIXES.iter().any(|(k, _)| *k == kind)
}

/// Evaluates every scanned developer item against the strict unattended
/// allowlist. Returns *all* eligible candidates (uncapped) plus a full
/// accounting of everything rejected and why — caps are applied separately
/// by `apply_caps`, so this function's output alone is exactly what a
/// dry run should report.
pub fn evaluate(dev_items: &[DevItemDto], home: &Path, exclusions: &[String]) -> EligibilityReport {
    let mut report = EligibilityReport::default();

    for item in dev_items {
        if !is_allowed_kind(&item.kind) {
            report.skipped.push(Skip {
                path: item.path.clone(),
                reason: format!("kind '{}' is not on the strict auto-clean allowlist", item.kind),
            });
            continue;
        }
        if !matches_known_shape(home, &item.kind, &item.path) {
            report.skipped.push(Skip {
                path: item.path.clone(),
                reason: format!("path does not match the known shape for '{}' — refusing to trust the label alone", item.kind),
            });
            continue;
        }
        if is_excluded(&item.path, exclusions) {
            report.skipped.push(Skip { path: item.path.clone(), reason: "excluded by user".to_string() });
            continue;
        }
        if looks_sensitive(Path::new(&item.path)) {
            report.skipped.push(Skip { path: item.path.clone(), reason: "matched a sensitive-keyword re-check".to_string() });
            continue;
        }
        if item.size_bytes == 0 {
            report.skipped.push(Skip { path: item.path.clone(), reason: "zero bytes".to_string() });
            continue;
        }

        report.eligible_bytes += item.size_bytes;
        report.eligible.push(Candidate {
            id: format!("autoclean:{}", item.path),
            name: item.label_or(&item.kind),
            path: item.path.clone(),
            size_bytes: item.size_bytes,
            kind: item.kind.clone(),
        });
    }

    report
}

/// Splits eligible candidates into "clean this run" (within both caps) and
/// "leave for later" (whatever didn't fit) — largest-first, so a run that
/// hits the byte cap spends it on the most worthwhile items rather than
/// stopping arbitrarily partway through an unordered list.
pub fn apply_caps(mut eligible: Vec<Candidate>, max_bytes: u64, max_items: usize) -> (Vec<Candidate>, Vec<Candidate>) {
    eligible.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    let mut to_clean = Vec::new();
    let mut deferred = Vec::new();
    let mut running_bytes: u64 = 0;

    for candidate in eligible {
        let would_be_bytes = running_bytes.saturating_add(candidate.size_bytes);
        if to_clean.len() >= max_items || would_be_bytes > max_bytes {
            deferred.push(candidate);
            continue;
        }
        running_bytes = would_be_bytes;
        to_clean.push(candidate);
    }

    (to_clean, deferred)
}

trait LabelOr {
    fn label_or(&self, fallback: &str) -> String;
}
impl LabelOr for DevItemDto {
    fn label_or(&self, fallback: &str) -> String {
        if self.label.trim().is_empty() { fallback.to_string() } else { self.label.clone() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(kind: &str, path: String, size_bytes: u64) -> DevItemDto {
        DevItemDto { kind: kind.to_string(), tool: "test".to_string(), label: String::new(), path, size_bytes, modified_ms: None }
    }

    fn home() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("mac-storage-manager-autoclean-test-{}", std::process::id()))
    }

    #[test]
    fn allows_all_six_allowlisted_kinds_at_their_known_paths() {
        let home = home();
        let cases = [
            ("xcode-derived-data", "Library/Developer/Xcode/DerivedData"),
            ("npm-cache", ".npm/_cacache"),
            ("yarn-cache", "Library/Caches/Yarn"),
            ("gradle-caches", ".gradle/caches"),
            ("cocoapods-cache", "Library/Caches/CocoaPods"),
            ("pnpm-store", "Library/pnpm/store"),
        ];
        let items: Vec<DevItemDto> = cases
            .iter()
            .map(|(kind, suffix)| item(kind, home.join(suffix).to_string_lossy().to_string(), 1_000))
            .collect();
        let report = evaluate(&items, &home, &[]);
        assert_eq!(report.eligible.len(), 6, "expected all six allowlisted kinds to be eligible, got {report:?}");
        assert_eq!(report.eligible_bytes, 6_000);
        assert!(report.skipped.is_empty());
    }

    #[test]
    fn rejects_metro_cache() {
        let home = home();
        let items = vec![item("metro-cache", std::env::temp_dir().to_string_lossy().to_string(), 500_000)];
        let report = evaluate(&items, &home, &[]);
        assert!(report.eligible.is_empty());
        assert_eq!(report.skipped.len(), 1);
        assert!(report.skipped[0].reason.contains("not on the strict auto-clean allowlist"));
    }

    #[test]
    fn rejects_xcode_archives_and_simulator_devices_and_android_avd() {
        let home = home();
        let items = vec![
            item("xcode-archives", home.join("Library/Developer/Xcode/Archives").to_string_lossy().to_string(), 1_000),
            item("xcode-simulator-devices", home.join("Library/Developer/CoreSimulator/Devices").to_string_lossy().to_string(), 1_000),
            item("android-avd", home.join(".android/avd").to_string_lossy().to_string(), 1_000),
        ];
        let report = evaluate(&items, &home, &[]);
        assert!(report.eligible.is_empty(), "expected none of these to be eligible, got {report:?}");
        assert_eq!(report.skipped.len(), 3);
    }

    #[test]
    fn rejects_unknown_kind() {
        let home = home();
        let items = vec![item("some-future-tool-cache", home.join("Library/Caches/SomeTool").to_string_lossy().to_string(), 1_000)];
        let report = evaluate(&items, &home, &[]);
        assert!(report.eligible.is_empty());
        assert!(report.skipped[0].reason.contains("not on the strict auto-clean allowlist"));
    }

    #[test]
    fn rejects_when_path_does_not_match_known_shape_even_for_allowed_kind() {
        let home = home();
        // Right kind, wrong path — e.g. if a future scanner bug mislabeled it.
        let items = vec![item("npm-cache", home.join("Documents/MyProject/not-actually-npm-cache").to_string_lossy().to_string(), 1_000)];
        let report = evaluate(&items, &home, &[]);
        assert!(report.eligible.is_empty());
        assert!(report.skipped[0].reason.contains("does not match the known shape"));
    }

    #[test]
    fn respects_exact_and_prefix_exclusions() {
        let home = home();
        let excluded_path = home.join(".npm/_cacache").to_string_lossy().to_string();
        let items = vec![item("npm-cache", excluded_path.clone(), 1_000)];
        let report = evaluate(&items, &home, &[excluded_path]);
        assert!(report.eligible.is_empty());
        assert_eq!(report.skipped[0].reason, "excluded by user");
    }

    #[test]
    fn sensitive_keyword_in_path_is_rejected_even_though_shape_check_would_normally_catch_it_first() {
        // None of the six fixed allowlisted suffixes contain a sensitive
        // keyword, so with today's exact-path-match shape check, a
        // sensitive-keyword path for an allowed kind will already have been
        // rejected by `matches_known_shape` before `looks_sensitive` is ever
        // reached — this test documents that the shape check itself is
        // already sufficient today, while `evaluate`'s explicit sensitivity
        // re-check remains as defense-in-depth against a future, looser
        // shape check (e.g. a prefix match instead of an exact one).
        let home = home();
        let path = home.join(".npm/_cacache").join("backup-of-something").to_string_lossy().to_string();
        let items = vec![item("npm-cache", path, 1_000)];
        let report = evaluate(&items, &home, &[]);
        assert!(report.eligible.is_empty());
        assert!(report.skipped[0].reason.contains("does not match the known shape"));
    }

    #[test]
    fn zero_byte_item_is_skipped() {
        let home = home();
        let items = vec![item("npm-cache", home.join(".npm/_cacache").to_string_lossy().to_string(), 0)];
        let report = evaluate(&items, &home, &[]);
        assert!(report.eligible.is_empty());
        assert_eq!(report.skipped[0].reason, "zero bytes");
    }

    #[test]
    fn apply_caps_enforces_byte_cap_largest_first() {
        let candidates = vec![
            Candidate { id: "a".into(), name: "a".into(), path: "/a".into(), size_bytes: 6_000_000_000, kind: "npm-cache".into() },
            Candidate { id: "b".into(), name: "b".into(), path: "/b".into(), size_bytes: 5_000_000_000, kind: "npm-cache".into() },
            Candidate { id: "c".into(), name: "c".into(), path: "/c".into(), size_bytes: 1_000_000_000, kind: "npm-cache".into() },
        ];
        let (to_clean, deferred) = apply_caps(candidates, 10_000_000_000, 50);
        assert_eq!(to_clean.len(), 2, "6GB + 1GB fits under 10GB; adding the 5GB one would not");
        assert_eq!(deferred.len(), 1);
        assert_eq!(deferred[0].size_bytes, 5_000_000_000);
    }

    #[test]
    fn apply_caps_enforces_item_count_cap() {
        let candidates: Vec<Candidate> = (0..5)
            .map(|i| Candidate { id: i.to_string(), name: i.to_string(), path: format!("/{i}"), size_bytes: 100, kind: "npm-cache".into() })
            .collect();
        let (to_clean, deferred) = apply_caps(candidates, u64::MAX, 3);
        assert_eq!(to_clean.len(), 3);
        assert_eq!(deferred.len(), 2);
    }

    #[test]
    fn apply_caps_never_exceeds_byte_cap() {
        let candidates = vec![
            Candidate { id: "a".into(), name: "a".into(), path: "/a".into(), size_bytes: 100, kind: "npm-cache".into() },
            Candidate { id: "b".into(), name: "b".into(), path: "/b".into(), size_bytes: 50, kind: "npm-cache".into() },
        ];
        let (to_clean, _) = apply_caps(candidates, 120, 50);
        let total: u64 = to_clean.iter().map(|c| c.size_bytes).sum();
        assert!(total <= 120, "must never exceed the byte cap, got {total}");
    }

    // --- End-to-end: proves the *existing* trash.rs safety layer still runs
    // for every auto-clean candidate, not just this module's own checks ---
    // (see the module doc: "an ADDITIONAL filter... never a replacement").

    use crate::trash::{trash_single_item, TrashRequestItem};
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static E2E_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn e2e_home(label: &str) -> std::path::PathBuf {
        let n = E2E_COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("mac-storage-manager-autoclean-e2e-{label}-{pid}-{n}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn to_trash_request(c: &Candidate) -> TrashRequestItem {
        TrashRequestItem { id: c.id.clone(), name: c.name.clone(), path: c.path.clone(), size_bytes: c.size_bytes, safety: "green".to_string() }
    }

    #[test]
    fn e2e_symlink_escaping_home_is_still_rejected_by_trash_layer_even_though_it_passes_evaluate() {
        let home = e2e_home("symlink");
        let outside = e2e_home("symlink-target");
        fs::write(outside.join("secret.txt"), b"outside").unwrap();

        // The npm-cache location *itself* is a symlink pointing outside
        // home. `evaluate()`'s shape check only compares path strings, so
        // this passes it — canonicalization in `trash::validate_path` is
        // what has to catch it, and this test proves it still does.
        std::os::unix::fs::symlink(&outside, home.join(".npm")).unwrap();
        let npm_cache_path = home.join(".npm/_cacache");

        let item = item("npm-cache", npm_cache_path.to_string_lossy().to_string(), 1_000);
        let report = evaluate(&[item], &home, &[]);
        assert_eq!(report.eligible.len(), 1, "expected evaluate() to accept it (this is exactly what makes the trash-layer check necessary)");

        let result = trash_single_item(&home, &to_trash_request(&report.eligible[0]));
        assert!(!result.success, "a symlink escaping home must still be rejected at the trash layer");
        assert!(outside.join("secret.txt").exists(), "the real target outside home must be untouched");
    }

    #[test]
    fn e2e_missing_file_since_scan_is_a_failure_not_a_panic() {
        let home = e2e_home("missing");
        // Never actually created on disk — simulates "disappeared since scan".
        let path = home.join(".npm/_cacache");
        let candidate = Candidate { id: "autoclean:missing".into(), name: "npm cache".into(), path: path.to_string_lossy().to_string(), size_bytes: 1_000, kind: "npm-cache".into() };
        let result = trash_single_item(&home, &to_trash_request(&candidate));
        assert!(!result.success);
        assert!(result.failure_reason.is_some());
    }

    #[test]
    fn e2e_partial_failure_one_missing_one_real_does_not_abort_the_batch() {
        let home = e2e_home("partial");
        let real_path = home.join(".npm/_cacache");
        fs::create_dir_all(&real_path).unwrap();
        fs::write(real_path.join("entry"), b"cached-package-data").unwrap();
        let missing_path = home.join("Library/Caches/Yarn");

        let candidates = vec![
            Candidate { id: "1".into(), name: "npm cache".into(), path: real_path.to_string_lossy().to_string(), size_bytes: 20, kind: "npm-cache".into() },
            Candidate { id: "2".into(), name: "Yarn cache".into(), path: missing_path.to_string_lossy().to_string(), size_bytes: 20, kind: "yarn-cache".into() },
        ];

        let results: Vec<_> = candidates.iter().map(|c| trash_single_item(&home, &to_trash_request(c))).collect();
        let successes = results.iter().filter(|r| r.success).count();
        let failures = results.iter().filter(|r| !r.success).count();
        assert_eq!(successes, 1, "the real item should succeed despite the other failing");
        assert_eq!(failures, 1, "the missing item should fail, not panic or abort the batch");
        assert!(!real_path.exists(), "the successfully-trashed real item should be gone from its original location");
    }

    #[test]
    fn e2e_path_outside_home_for_an_allowed_kind_is_rejected() {
        let home = e2e_home("outside-home");
        let outside = e2e_home("outside-home-target");
        // Right kind label, but a path that was never actually under this
        // home — evaluate()'s exact-suffix shape check already rejects this
        // (proven by the shape-mismatch unit test above); this test proves
        // the trash layer would *also* reject it if it somehow got through.
        let candidate = Candidate { id: "1".into(), name: "npm cache".into(), path: outside.to_string_lossy().to_string(), size_bytes: 20, kind: "npm-cache".into() };
        let result = trash_single_item(&home, &to_trash_request(&candidate));
        assert!(!result.success, "a path outside the given home must be rejected regardless of claimed kind");
    }
}
