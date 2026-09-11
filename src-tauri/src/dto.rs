use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverviewDto {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    /// Space macOS considers reclaimable-if-needed (local snapshots, evictable
    /// caches) — already counted inside `free_bytes`, not on top of it. Real
    /// OS-level purgeable space, not this app's identified cleanup candidates.
    pub purgeable_bytes: u64,
    pub volume_name: String,
    pub home_dir: String,
    pub username: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFileDto {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
    pub accessed_ms: Option<u64>,
    pub extension: Option<String>,
    /// Which configured root this file was found under: "downloads" | "desktop" | "documents"
    pub root: String,
    /// Shared id when this file's (size, partial-content-hash) matches another scanned file.
    pub duplicate_group: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DevItemDto {
    /// Stable identifier, e.g. "xcode-derived-data", used by the frontend classifier.
    pub kind: String,
    pub tool: String,
    pub label: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserItemDto {
    pub browser_id: String,
    pub name: String,
    pub cache_bytes: u64,
    pub accessible: bool,
    pub cache_path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppItemDto {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub version: Option<String>,
    pub bundle_id: Option<String>,
    pub last_used_ms: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PathAccessDto {
    pub path: String,
    /// "accessible" | "denied" | "not-found"
    pub state: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarningDto {
    pub path: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    pub phase: String,
    pub label: String,
    pub done: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FullScanResultDto {
    pub overview: SystemOverviewDto,
    pub files: Vec<ScannedFileDto>,
    pub developer: Vec<DevItemDto>,
    pub browsers: Vec<BrowserItemDto>,
    pub applications: Vec<AppItemDto>,
    pub warnings: Vec<ScanWarningDto>,
    pub scanned_at_ms: u64,
}
