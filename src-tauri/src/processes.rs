//! Running-process inventory and safe, user-initiated termination.
//!
//! Sources, all public macOS APIs:
//!   - process list, CPU %, disk I/O: `sysinfo` (libproc underneath)
//!   - memory: `proc_pid_rusage` → `ri_phys_footprint`, the same "Memory"
//!     figure Activity Monitor shows (resident size over-counts shared pages)
//!   - which processes are user-facing apps, their names and icons:
//!     `NSWorkspace.runningApplications` / `NSRunningApplication`
//!   - identity re-verification before termination: `proc_pidinfo`
//!     (`PROC_PIDTBSDINFO` → start time + status)
//!
//! SAFETY invariants for termination (`terminate`), each enforced natively —
//! never on the frontend's word:
//!   1. Only ever runs because the user clicked Quit / Force Quit and (for
//!      Force Quit) confirmed a dialog. Nothing in this app terminates a
//!      process automatically — high RAM or CPU only ever produces an alert.
//!   2. The PID is re-resolved immediately before acting, and its kernel
//!      start time must equal the one the user was looking at — a PID that
//!      was recycled by a different process is refused (`IdentityMismatch`).
//!   3. Protected processes are refused outright: this app itself, PID 0/1,
//!      named critical services, anything owned by another user (root/system
//!      daemons), and anything whose executable lives in a sealed system
//!      location. No privilege elevation is ever attempted, so macOS's own
//!      permission model is the final word (`EPERM` → `PermissionDenied`).
//!   4. Quit is graceful (`NSRunningApplication.terminate` — the same Apple
//!      Event as ⌘Q, so the app can prompt to save — or `SIGTERM` for a
//!      non-app process). Force Quit uses `forceTerminate` / `SIGKILL`.
//!   5. The reported outcome is what actually happened: the process is
//!      polled until it is gone or a timeout passes, and "still running" is
//!      reported as such rather than assumed to have succeeded.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind, Users};

use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication, NSWorkspace};

/// Names that must never be terminated even if somehow owned by the current
/// user or living outside a system path. Matching is exact.
const CRITICAL_NAMES: &[&str] = &[
    "kernel_task",
    "launchd",
    "WindowServer",
    "loginwindow",
    "logd",
    "opendirectoryd",
    "securityd",
    "trustd",
    "syspolicyd",
    "configd",
    "coreservicesd",
    "mds",
    "notifyd",
    "UserEventAgent",
    "cfprefsd",
    "distnoted",
    "Dock",
    "Finder",
    "SystemUIServer",
    "ControlCenter",
];

/// Executables under these prefixes are part of macOS (on the sealed system
/// volume or Apple-managed) — never terminable from here. The two
/// /Library/Developer entries are the simulated OS's own daemons inside
/// running iOS/watchOS simulators (launchd_sim and friends) and Xcode's
/// device services: user-owned, but ending them breaks Simulator/Xcode in
/// ways that look like crashes, so they are treated as system processes.
const SYSTEM_PATH_PREFIXES: &[&str] = &[
    "/System/",
    "/usr/libexec/",
    "/usr/sbin/",
    "/sbin/",
    "/Library/Apple/",
    "/Library/Developer/CoreSimulator/",
    "/Library/Developer/PrivateFrameworks/",
];

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProcessKind {
    /// A regular app with a Dock icon / menu bar (activation policy Regular).
    App,
    /// Everything else running as the current user: menu-bar agents, helpers, CLI tools.
    Background,
    /// Owned by another user (root/system daemons) or living in a system location.
    System,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Protection {
    SelfProcess,
    Kernel,
    Critical,
    OtherUser,
    SystemPath,
    Unverified,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDto {
    pub pid: i32,
    pub parent_pid: Option<i32>,
    pub name: String,
    pub bundle_id: Option<String>,
    pub path: Option<String>,
    /// `ri_phys_footprint`. `None` when macOS doesn't let a normal user read
    /// it (processes owned by other users) — never reported as 0.
    pub memory_bytes: Option<u64>,
    /// For apps: this process plus every helper whose executable lives inside
    /// the same .app bundle (how Chrome/Safari/Electron apps split their
    /// memory). Equal to `memory_bytes` when there are no helpers.
    pub group_memory_bytes: Option<u64>,
    pub group_cpu_percent: Option<f32>,
    pub helper_count: u32,
    /// % of one core, like Activity Monitor (can exceed 100 on multi-core
    /// work). `None` until two samples exist, or when unreadable.
    pub cpu_percent: Option<f32>,
    pub kind: ProcessKind,
    /// Kernel scheduler state, when readable ("running", "sleeping", …).
    pub status: Option<String>,
    pub is_hidden: Option<bool>,
    pub is_active: Option<bool>,
    pub start_time: u64,
    pub user: Option<String>,
    pub protection: Option<Protection>,
    /// True for helpers that are already counted inside an app's group totals.
    pub is_app_helper: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessListDto {
    pub processes: Vec<ProcessDto>,
    pub total_count: u32,
    pub app_count: u32,
    pub background_count: u32,
    pub system_count: u32,
    /// Whether CPU % values come from a real interval (false on the very first sample).
    pub cpu_measured: bool,
    /// Bytes read/written by accessible processes since the previous sample, per second.
    pub disk_read_bytes_per_sec: Option<f64>,
    pub disk_write_bytes_per_sec: Option<f64>,
    pub sampled_at_ms: u64,
}

struct AppInfo {
    name: Option<String>,
    bundle_id: Option<String>,
    bundle_path: Option<String>,
    regular: bool,
    hidden: bool,
    active: bool,
}

fn running_apps() -> HashMap<i32, AppInfo> {
    let mut map = HashMap::new();
    let workspace = NSWorkspace::sharedWorkspace();
    for app in workspace.runningApplications().iter() {
        let pid = app.processIdentifier();
        if pid <= 0 {
            continue;
        }
        map.insert(
            pid,
            AppInfo {
                name: app.localizedName().map(|s| s.to_string()),
                bundle_id: app.bundleIdentifier().map(|s| s.to_string()),
                bundle_path: app.bundleURL().and_then(|u| u.path()).map(|p| p.to_string()),
                regular: app.activationPolicy() == NSApplicationActivationPolicy::Regular,
                hidden: app.isHidden(),
                active: app.isActive(),
            },
        );
    }
    map
}

/// `ri_phys_footprint` for a process, if this user is allowed to read it.
pub fn phys_footprint(pid: i32) -> Option<u64> {
    let mut info: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V2, (&mut info as *mut libc::rusage_info_v2).cast()) };
    (rc == 0).then_some(info.ri_phys_footprint)
}

/// (start time secs, uid, is_zombie) straight from the kernel — used to
/// re-verify identity right before termination and to detect exit.
fn bsd_info(pid: i32) -> Option<(u64, u32, bool)> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let n = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size) };
    (n == size).then(|| (info.pbi_start_tvsec, info.pbi_uid, info.pbi_status == libc::SZOMB))
}

fn status_label(status: ProcessStatus) -> Option<&'static str> {
    Some(match status {
        ProcessStatus::Run => "running",
        ProcessStatus::Sleep => "sleeping",
        ProcessStatus::Idle => "idle",
        ProcessStatus::Stop => "stopped",
        ProcessStatus::Zombie => "zombie",
        _ => return None,
    })
}

fn current_uid() -> u32 {
    unsafe { libc::getuid() }
}

/// `regular_app`: the process is a Dock-visible app (NSRunningApplication
/// activation policy Regular). Apple's own apps — Safari, Music, TextEdit —
/// live under /System/Applications or a system cryptex, but they are
/// ordinary apps the user can always quit, so the system-path rule only
/// applies to non-app processes (daemons, agents, helpers).
pub fn protection_for(pid: i32, name: &str, uid: Option<u32>, path: Option<&str>, regular_app: bool) -> Option<Protection> {
    if pid as u32 == std::process::id() {
        return Some(Protection::SelfProcess);
    }
    if pid <= 1 || name == "kernel_task" {
        return Some(Protection::Kernel);
    }
    if CRITICAL_NAMES.contains(&name) {
        return Some(Protection::Critical);
    }
    match uid {
        Some(u) if u != current_uid() => return Some(Protection::OtherUser),
        None => return Some(Protection::Unverified),
        _ => {}
    }
    if regular_app {
        return None;
    }
    match path {
        Some(p) if SYSTEM_PATH_PREFIXES.iter().any(|prefix| p.starts_with(prefix)) => Some(Protection::SystemPath),
        Some(_) => None,
        // Without an executable path the process can't be positively
        // identified as a user process — refuse rather than guess.
        None => Some(Protection::Unverified),
    }
}

fn classify(uid: Option<u32>, path: Option<&str>, app: Option<&AppInfo>) -> ProcessKind {
    if let Some(a) = app {
        if a.regular {
            return ProcessKind::App;
        }
    }
    let other_user = uid.map(|u| u != current_uid()).unwrap_or(true);
    let system_path = path.map(|p| SYSTEM_PATH_PREFIXES.iter().any(|prefix| p.starts_with(prefix))).unwrap_or(false);
    if other_user || system_path {
        ProcessKind::System
    } else {
        ProcessKind::Background
    }
}

/// Keeps one `sysinfo::System` alive between samples — CPU % is only
/// meaningful as a delta between two refreshes of the same instance.
pub struct ProcessSampler {
    system: System,
    users: Users,
    samples: u32,
    last_sample: Option<Instant>,
    /// Refresh number at which each (pid, start time) was first seen.
    /// sysinfo only records a process's CPU-time baseline on its *second*
    /// refresh, so its CPU % is real from the third one on — before that
    /// it reads 0.0, which must not be shown as a measurement.
    first_seen: HashMap<(i32, u64), u32>,
}

impl ProcessSampler {
    pub fn new() -> Self {
        Self { system: System::new(), users: Users::new_with_refreshed_list(), samples: 0, last_sample: None, first_seen: HashMap::new() }
    }

    fn refresh(&mut self) -> f64 {
        let kind = ProcessRefreshKind::nothing()
            .with_cpu()
            .with_disk_usage()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_user(UpdateKind::OnlyIfNotSet);
        self.system.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        self.samples += 1;
        let now = Instant::now();
        let elapsed = self.last_sample.map(|t| now.duration_since(t).as_secs_f64()).unwrap_or(0.0);
        self.last_sample = Some(now);
        elapsed
    }

    pub fn sample(&mut self) -> ProcessListDto {
        let elapsed = self.refresh();
        let samples = self.samples;
        let live: HashSet<(i32, u64)> = self.system.processes().iter().map(|(p, pr)| (p.as_u32() as i32, pr.start_time())).collect();
        self.first_seen.retain(|k, _| live.contains(k));
        for key in &live {
            self.first_seen.entry(*key).or_insert(samples);
        }
        let cpu_measured = samples >= 3;
        let apps = running_apps();
        let uid_now = current_uid();

        let mut rows: Vec<ProcessDto> = Vec::with_capacity(self.system.processes().len());
        let mut disk_read = 0u64;
        let mut disk_write = 0u64;

        for (pid, proc_) in self.system.processes() {
            let pid = pid.as_u32() as i32;
            let uid = proc_.user_id().map(|u| **u);
            let path = proc_.exe().map(|p| p.to_string_lossy().to_string());
            let app = apps.get(&pid);
            let memory = phys_footprint(pid);
            // CPU is only readable for the same processes rusage is; a 0.0
            // from sysinfo for an unreadable process would be a fabrication.
            let measurable = self.first_seen.get(&(pid, proc_.start_time())).map(|first| samples >= first + 2).unwrap_or(false);
            let cpu = (measurable && memory.is_some()).then(|| proc_.cpu_usage());
            if memory.is_some() {
                let d = proc_.disk_usage();
                disk_read += d.read_bytes;
                disk_write += d.written_bytes;
            }
            let exe_name = path.as_deref().and_then(|p| Path::new(p).file_name()).map(|n| n.to_string_lossy().to_string());
            let name = app
                .and_then(|a| a.name.clone())
                .or(exe_name)
                .unwrap_or_else(|| proc_.name().to_string_lossy().to_string());
            let kernel_name = proc_.name().to_string_lossy().to_string();
            let regular = app.map(|a| a.regular).unwrap_or(false);
            let protection = protection_for(pid, &kernel_name, uid, path.as_deref(), regular)
                .or_else(|| protection_for(pid, &name, uid, path.as_deref(), regular));
            rows.push(ProcessDto {
                pid,
                parent_pid: proc_.parent().map(|p| p.as_u32() as i32),
                name,
                bundle_id: app.and_then(|a| a.bundle_id.clone()),
                path,
                memory_bytes: memory,
                group_memory_bytes: memory,
                group_cpu_percent: cpu,
                helper_count: 0,
                cpu_percent: cpu,
                kind: classify(uid, proc_.exe().and_then(|p| p.to_str()), app),
                status: status_label(proc_.status()).map(String::from),
                is_hidden: app.map(|a| a.hidden),
                is_active: app.map(|a| a.active),
                start_time: proc_.start_time(),
                user: proc_.user_id().and_then(|u| self.users.get_user_by_id(u)).map(|u| u.name().to_string()).or_else(|| {
                    uid.filter(|u| *u == uid_now).map(|_| whoami::username())
                }),
                protection,
                is_app_helper: false,
            });
        }

        group_app_helpers(&mut rows, &apps);

        let count = |k: ProcessKind| rows.iter().filter(|r| r.kind == k).count() as u32;
        let rate = |bytes: u64| (elapsed > 0.0 && samples >= 2).then(|| bytes as f64 / elapsed);
        ProcessListDto {
            total_count: rows.len() as u32,
            app_count: count(ProcessKind::App),
            background_count: count(ProcessKind::Background),
            system_count: count(ProcessKind::System),
            cpu_measured,
            disk_read_bytes_per_sec: rate(disk_read),
            disk_write_bytes_per_sec: rate(disk_write),
            sampled_at_ms: now_ms(),
            processes: rows,
        }
    }
}

/// Folds helper processes whose executables live inside a running app's
/// bundle into that app's group totals (e.g. "Google Chrome Helper
/// (Renderer)" → Google Chrome). Grouping is by bundle path prefix only — a
/// verifiable on-disk fact — never by name similarity.
fn group_app_helpers(rows: &mut [ProcessDto], apps: &HashMap<i32, AppInfo>) {
    let bundles: Vec<(i32, String)> = rows
        .iter()
        .filter(|r| r.kind == ProcessKind::App)
        .filter_map(|r| apps.get(&r.pid).and_then(|a| a.bundle_path.clone()).map(|b| (r.pid, format!("{}/", b.trim_end_matches('/')))))
        .collect();
    if bundles.is_empty() {
        return;
    }
    let app_pids: HashSet<i32> = bundles.iter().map(|(p, _)| *p).collect();
    let mut totals: HashMap<i32, (u64, f32, u32, bool)> = HashMap::new();
    let mut helper_flags: Vec<usize> = Vec::new();
    for (idx, row) in rows.iter().enumerate() {
        if app_pids.contains(&row.pid) {
            continue;
        }
        let Some(path) = row.path.as_deref() else { continue };
        // Longest matching bundle wins (nested bundles are rare but possible).
        let Some((owner, _)) = bundles.iter().filter(|(_, b)| path.starts_with(b.as_str())).max_by_key(|(_, b)| b.len()) else {
            continue;
        };
        let entry = totals.entry(*owner).or_insert((0, 0.0, 0, true));
        match row.memory_bytes {
            Some(m) => entry.0 += m,
            None => entry.3 = false,
        }
        entry.1 += row.cpu_percent.unwrap_or(0.0);
        entry.2 += 1;
        helper_flags.push(idx);
    }
    for idx in helper_flags {
        rows[idx].is_app_helper = true;
    }
    for row in rows.iter_mut() {
        if let Some((mem, cpu, helpers, complete)) = totals.get(&row.pid) {
            row.helper_count = *helpers;
            row.group_memory_bytes = match (row.memory_bytes, complete) {
                (Some(own), true) => Some(own + mem),
                _ => row.memory_bytes,
            };
            row.group_cpu_percent = row.cpu_percent.map(|c| c + cpu);
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetailsDto {
    pub pid: i32,
    pub parent_pid: Option<i32>,
    pub parent_name: Option<String>,
    pub name: String,
    pub bundle_id: Option<String>,
    pub path: Option<String>,
    pub user: Option<String>,
    pub start_time: u64,
    pub run_time_secs: u64,
    pub memory_bytes: Option<u64>,
    pub resident_bytes: Option<u64>,
    pub virtual_bytes: Option<u64>,
    pub disk_read_total_bytes: Option<u64>,
    pub disk_written_total_bytes: Option<u64>,
    pub cpu_time_secs: Option<f64>,
    pub status: Option<String>,
    pub kind: ProcessKind,
    pub protection: Option<Protection>,
}

pub fn details(pid: i32) -> Option<ProcessDetailsDto> {
    let mut system = System::new();
    let sys_pid = Pid::from_u32(pid as u32);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[sys_pid]),
        true,
        ProcessRefreshKind::nothing().with_memory().with_exe(UpdateKind::Always).with_user(UpdateKind::Always),
    );
    let proc_ = system.process(sys_pid)?;
    let uid = proc_.user_id().map(|u| **u);
    let path = proc_.exe().map(|p| p.to_string_lossy().to_string());
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid);
    let app_info = app.as_ref().map(|a| AppInfo {
        name: a.localizedName().map(|s| s.to_string()),
        bundle_id: a.bundleIdentifier().map(|s| s.to_string()),
        bundle_path: None,
        regular: a.activationPolicy() == NSApplicationActivationPolicy::Regular,
        hidden: a.isHidden(),
        active: a.isActive(),
    });
    let users = Users::new_with_refreshed_list();
    let parent_pid = proc_.parent().map(|p| p.as_u32() as i32);
    let parent_name = parent_pid.and_then(|pp| {
        let mut parent_system = System::new();
        let parent = Pid::from_u32(pp as u32);
        parent_system.refresh_processes_specifics(ProcessesToUpdate::Some(&[parent]), false, ProcessRefreshKind::nothing());
        parent_system.process(parent).map(|p| p.name().to_string_lossy().to_string())
    });

    let mut rusage: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    let readable = unsafe { libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V2, (&mut rusage as *mut libc::rusage_info_v2).cast()) } == 0;
    let kernel_name = proc_.name().to_string_lossy().to_string();
    let name = app_info.as_ref().and_then(|a| a.name.clone()).unwrap_or_else(|| kernel_name.clone());

    Some(ProcessDetailsDto {
        pid,
        parent_pid,
        parent_name,
        bundle_id: app_info.as_ref().and_then(|a| a.bundle_id.clone()),
        user: proc_.user_id().and_then(|u| users.get_user_by_id(u)).map(|u| u.name().to_string()),
        start_time: proc_.start_time(),
        run_time_secs: proc_.run_time(),
        memory_bytes: readable.then_some(rusage.ri_phys_footprint),
        resident_bytes: readable.then_some(rusage.ri_resident_size),
        virtual_bytes: readable.then(|| proc_.virtual_memory()).filter(|v| *v > 0),
        disk_read_total_bytes: readable.then_some(rusage.ri_diskio_bytesread),
        disk_written_total_bytes: readable.then_some(rusage.ri_diskio_byteswritten),
        cpu_time_secs: readable.then(|| mach_abs_to_secs(rusage.ri_user_time + rusage.ri_system_time)),
        status: status_label(proc_.status()).map(String::from),
        kind: classify(uid, path.as_deref(), app_info.as_ref()),
        protection: {
            let regular = app_info.as_ref().map(|a| a.regular).unwrap_or(false);
            protection_for(pid, &kernel_name, uid, path.as_deref(), regular).or_else(|| protection_for(pid, &name, uid, path.as_deref(), regular))
        },
        name,
        path,
    })
}

/// `ri_user_time`/`ri_system_time` are in Mach absolute time units.
#[allow(deprecated)]
fn mach_abs_to_secs(ticks: u64) -> f64 {
    let mut tb = libc::mach_timebase_info { numer: 0, denom: 0 };
    #[allow(deprecated)]
    let ok = unsafe { libc::mach_timebase_info(&mut tb) } == 0 && tb.denom != 0;
    let nanos = if ok { ticks as f64 * tb.numer as f64 / tb.denom as f64 } else { ticks as f64 };
    nanos / 1e9
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminateOutcome {
    /// Verified gone.
    Exited,
    /// Request delivered, but the process is still running when we stopped
    /// waiting (typically an app showing a "save changes?" dialog).
    StillRunning,
    /// The app declined / couldn't receive the quit request.
    Refused,
    NotFound,
    /// The PID now belongs to a different process than the one shown.
    IdentityMismatch,
    Protected,
    PermissionDenied,
    Failed,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminateResultDto {
    pub outcome: TerminateOutcome,
    pub protection: Option<Protection>,
    pub message: Option<String>,
}

fn result(outcome: TerminateOutcome) -> TerminateResultDto {
    TerminateResultDto { outcome, protection: None, message: None }
}

/// Polls until the process with this exact start time is gone (or a zombie
/// awaiting reaping by its parent — it holds no resources at that point).
fn wait_for_exit(pid: i32, start_time: u64, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match bsd_info(pid) {
            None => return true,
            Some((st, _, zombie)) if st != start_time || zombie => return true,
            _ => {}
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// See the module-level SAFETY invariants. Blocking (waits for exit) — call
/// from a blocking worker, never the UI thread.
pub fn terminate(pid: i32, expected_start_time: u64, force: bool) -> TerminateResultDto {
    // 0. Never this app, the kernel or launchd — checked before anything else.
    if pid as u32 == std::process::id() || pid <= 1 {
        let protection = if pid <= 1 { Protection::Kernel } else { Protection::SelfProcess };
        return TerminateResultDto { outcome: TerminateOutcome::Protected, protection: Some(protection), message: None };
    }

    // 1. Re-verify identity against the kernel right now.
    let Some((start_time, uid, zombie)) = bsd_info(pid) else {
        // The kernel refuses to describe another user's process to us; it
        // exists (EPERM, not ESRCH) but is not ours to end.
        let exists_but_foreign = unsafe { libc::kill(pid, 0) } != 0
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
        return if exists_but_foreign {
            TerminateResultDto { outcome: TerminateOutcome::Protected, protection: Some(Protection::OtherUser), message: None }
        } else {
            result(TerminateOutcome::NotFound)
        };
    };
    if zombie {
        return result(TerminateOutcome::Exited);
    }
    if start_time != expected_start_time {
        return result(TerminateOutcome::IdentityMismatch);
    }

    // 2. Protection, from freshly read kernel facts.
    let mut system = System::new();
    let sys_pid = Pid::from_u32(pid as u32);
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&[sys_pid]), true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Always));
    let (name, path) = match system.process(sys_pid) {
        Some(p) => (p.name().to_string_lossy().to_string(), p.exe().map(|e| e.to_string_lossy().to_string())),
        None => return result(TerminateOutcome::NotFound),
    };
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid);
    let regular = app.as_ref().map(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular).unwrap_or(false);
    let display_name = app.as_ref().and_then(|a| a.localizedName()).map(|n| n.to_string());
    let protection = protection_for(pid, &name, Some(uid), path.as_deref(), regular)
        .or_else(|| display_name.as_deref().and_then(|n| protection_for(pid, n, Some(uid), path.as_deref(), regular)));
    if let Some(protection) = protection {
        log::info!("[processes] refused to terminate protected pid {pid} ({protection:?})");
        return TerminateResultDto { outcome: TerminateOutcome::Protected, protection: Some(protection), message: None };
    }

    // 3. Deliver the request.
    let delivered = match &app {
        Some(app) => {
            let ok = if force { app.forceTerminate() } else { app.terminate() };
            if !ok {
                return result(TerminateOutcome::Refused);
            }
            true
        }
        None => {
            let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
            if unsafe { libc::kill(pid, signal) } != 0 {
                let err = std::io::Error::last_os_error();
                return match err.raw_os_error() {
                    Some(libc::EPERM) => result(TerminateOutcome::PermissionDenied),
                    Some(libc::ESRCH) => result(TerminateOutcome::NotFound),
                    _ => TerminateResultDto { outcome: TerminateOutcome::Failed, protection: None, message: Some(err.to_string()) },
                };
            }
            true
        }
    };
    debug_assert!(delivered);
    log::info!("[processes] {} requested for pid {pid}", if force { "force quit" } else { "quit" });

    // 4. Report what actually happened.
    let timeout = if force { Duration::from_secs(3) } else { Duration::from_secs(6) };
    if wait_for_exit(pid, start_time, timeout) {
        result(TerminateOutcome::Exited)
    } else {
        result(TerminateOutcome::StillRunning)
    }
}

// --- App icons -------------------------------------------------------------

static ICON_CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// PNG data URL (64×64 px) of a running app's real icon, cached per bundle.
/// Must be called on the main thread (AppKit drawing).
pub fn app_icon_data_url(pid: i32) -> Option<String> {
    use base64::Engine;
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace, NSGraphicsContext};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize};

    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
    let key = app
        .bundleURL()
        .and_then(|u| u.path())
        .map(|p| p.to_string())
        .unwrap_or_else(|| format!("pid:{pid}"));
    if let Some(cached) = ICON_CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(&key) {
        return cached.clone();
    }
    let icon = app.icon()?;
    const PX: isize = 64;
    let png = unsafe {
        let rep = NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            PX,
            PX,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        );
        rep.and_then(|rep| {
            let ctx = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
            NSGraphicsContext::saveGraphicsState_class();
            NSGraphicsContext::setCurrentContext(Some(&ctx));
            let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(PX as f64, PX as f64));
            icon.drawInRect_fromRect_operation_fraction(rect, NSRect::ZERO, NSCompositingOperation::SourceOver, 1.0);
            ctx.flushGraphics();
            NSGraphicsContext::restoreGraphicsState_class();
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        })
    };
    let url = png.map(|data| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(data.to_vec())));
    ICON_CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, url.clone());
    url
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn protected_processes_are_refused() {
        assert_eq!(protection_for(0, "kernel_task", Some(0), None, false), Some(Protection::Kernel));
        assert_eq!(protection_for(1, "launchd", Some(0), Some("/sbin/launchd"), false), Some(Protection::Kernel));
        assert_eq!(protection_for(std::process::id() as i32, "app", Some(current_uid()), Some("/x"), true), Some(Protection::SelfProcess));
        assert_eq!(protection_for(500, "WindowServer", Some(current_uid()), Some("/x"), false), Some(Protection::Critical));
        assert_eq!(protection_for(500, "foo", Some(0), Some("/Applications/Foo.app/Contents/MacOS/foo"), true), Some(Protection::OtherUser));
        assert_eq!(
            protection_for(500, "foo", Some(current_uid()), Some("/System/Library/CoreServices/foo"), false),
            Some(Protection::SystemPath)
        );
        assert_eq!(protection_for(500, "foo", Some(current_uid()), None, false), Some(Protection::Unverified));
        assert_eq!(protection_for(500, "foo", Some(current_uid()), Some("/Applications/Foo.app/Contents/MacOS/foo"), false), None);
        // Apple's own apps live in system locations but are ordinary, quittable apps…
        assert_eq!(protection_for(500, "Safari", Some(current_uid()), Some("/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari"), true), None);
        assert_eq!(protection_for(500, "TextEdit", Some(current_uid()), Some("/System/Applications/TextEdit.app/Contents/MacOS/TextEdit"), true), None);
        // …but Finder/Dock stay protected even though they are apps,
        assert_eq!(protection_for(500, "Finder", Some(current_uid()), Some("/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder"), true), Some(Protection::Critical));
        // and a non-app process in a system location stays protected.
        assert_eq!(protection_for(500, "mdworker", Some(current_uid()), Some("/System/Library/Frameworks/x"), false), Some(Protection::SystemPath));
        // Simulator runtime daemons are system processes of the simulated OS.
        assert_eq!(
            protection_for(500, "launchd_sim", Some(current_uid()), Some("/Library/Developer/CoreSimulator/Volumes/iOS_22A/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 18.0.simruntime/Contents/Resources/RuntimeRoot/sbin/launchd_sim"), false),
            Some(Protection::SystemPath)
        );
    }

    #[test]
    fn terminate_refuses_launchd_and_self() {
        let launchd = terminate(1, bsd_info(1).map(|i| i.0).unwrap_or(0), true);
        assert_eq!(launchd.outcome, TerminateOutcome::Protected);
        // A root-owned daemon other than launchd: WindowServer-style system
        // process the current user can't even inspect.
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_user(UpdateKind::Always));
        let root_pid = sys
            .processes()
            .iter()
            .find(|(p, proc_)| p.as_u32() > 1 && proc_.user_id().map(|u| **u == 0).unwrap_or(false))
            .map(|(p, _)| p.as_u32() as i32)
            .expect("some root-owned process exists");
        let root = terminate(root_pid, bsd_info(root_pid).map(|i| i.0).unwrap_or(0), true);
        assert_eq!(root.outcome, TerminateOutcome::Protected, "root pid {root_pid}: {root:?}");
        let me = std::process::id() as i32;
        let own = terminate(me, bsd_info(me).unwrap().0, true);
        assert_eq!(own.outcome, TerminateOutcome::Protected);
        assert_eq!(own.protection, Some(Protection::SelfProcess));
        // launchd can't be inspected by a normal user; EPERM (not ESRCH) from
        // a null signal proves it still exists.
        let alive = unsafe { libc::kill(1, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
        assert!(alive, "launchd must still be running");
    }

    /// `/bin/sleep` lives outside the protected system prefixes, so it is a
    /// harmless, terminable process owned by the current user.
    fn spawn_sleep() -> std::process::Child {
        Command::new("/bin/sleep").arg("60").spawn().expect("spawn sleep")
    }

    #[test]
    fn graceful_quit_terminates_a_harmless_process_and_reports_exit() {
        let mut child = spawn_sleep();
        let pid = child.id() as i32;
        let start = bsd_info(pid).unwrap().0;
        let r = terminate(pid, start, false);
        assert_eq!(r.outcome, TerminateOutcome::Exited, "{r:?}");
        let _ = child.wait();
    }

    #[test]
    fn force_quit_terminates_a_harmless_process_and_reports_exit() {
        let mut child = spawn_sleep();
        let pid = child.id() as i32;
        let start = bsd_info(pid).unwrap().0;
        let r = terminate(pid, start, true);
        assert_eq!(r.outcome, TerminateOutcome::Exited, "{r:?}");
        let status = child.wait().unwrap();
        assert!(!status.success());
    }

    #[test]
    fn stale_start_time_is_rejected_as_pid_reuse() {
        let mut child = spawn_sleep();
        let pid = child.id() as i32;
        let start = bsd_info(pid).unwrap().0;
        let r = terminate(pid, start + 12345, true);
        assert_eq!(r.outcome, TerminateOutcome::IdentityMismatch);
        assert!(bsd_info(pid).is_some(), "process must not have been touched");
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Live end-to-end check against real, harmless Apple apps (TextEdit,
    /// Chess) through the NSRunningApplication path. Opens them hidden in
    /// the background. Ignored by default because it launches GUI apps:
    /// `cargo test real_app -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_app_graceful_quit_and_force_quit() {
        // NSWorkspace.runningApplications only refreshes on a thread whose
        // run loop runs (the app's main thread does; a test thread doesn't),
        // so discovery here uses pgrep; termination still goes through
        // NSRunningApplication exactly as in the app.
        fn launch(bundle_id: &str, process_name: &str) -> i32 {
            Command::new("/usr/bin/open").args(["-g", "-j", "-b", bundle_id]).status().expect("open");
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                let out = Command::new("/usr/bin/pgrep").args(["-x", process_name]).output().expect("pgrep");
                if let Some(pid) = String::from_utf8_lossy(&out.stdout).lines().next().and_then(|l| l.trim().parse().ok()) {
                    std::thread::sleep(Duration::from_millis(1500));
                    return pid;
                }
                assert!(Instant::now() < deadline, "{bundle_id} did not launch");
                std::thread::sleep(Duration::from_millis(250));
            }
        }
        let text_edit = launch("com.apple.TextEdit", "TextEdit");
        let r = terminate(text_edit, bsd_info(text_edit).unwrap().0, false);
        println!("TextEdit graceful quit: {r:?}");
        assert_eq!(r.outcome, TerminateOutcome::Exited);

        let chess = launch("com.apple.Chess", "Chess");
        let r = terminate(chess, bsd_info(chess).unwrap().0, true);
        println!("Chess force quit: {r:?}");
        assert_eq!(r.outcome, TerminateOutcome::Exited);
    }

    /// Live audit over every running process, classified exactly as the UI
    /// sees it. Run explicitly: `cargo test safety_audit -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn safety_audit_of_live_processes() {
        let mut sampler = ProcessSampler::new();
        let list = sampler.sample();
        let me = std::process::id() as i32;
        let must_protect = ["kernel_task", "launchd", "WindowServer", "loginwindow", "Dock", "Finder", "SystemUIServer", "ControlCenter"];
        let mut violations = Vec::new();
        for p in &list.processes {
            let critical = must_protect.iter().any(|n| p.name == *n || p.path.as_deref().map(|x| x.ends_with(&format!("/{n}"))).unwrap_or(false));
            let other_user = p.kind == ProcessKind::System && p.memory_bytes.is_none();
            if (p.pid <= 1 || p.pid == me || critical || other_user) && p.protection.is_none() {
                violations.push(format!("{} (pid {}) is terminable but must be protected", p.name, p.pid));
            }
        }
        let terminable: Vec<String> = list
            .processes
            .iter()
            .filter(|p| p.protection.is_none())
            .map(|p| format!("{:?} {} [{}]", p.kind, p.name, p.path.as_deref().unwrap_or("?")))
            .collect();
        println!("processes: {}  protected: {}  terminable: {}", list.processes.len(), list.processes.len() - terminable.len(), terminable.len());
        let mut sorted = terminable.clone();
        sorted.sort();
        for t in &sorted {
            println!("  terminable: {t}");
        }
        for v in &violations {
            println!("VIOLATION: {v}");
        }
        assert!(violations.is_empty(), "{} protection violations", violations.len());
        // Every terminable process must be owned by this user.
        for p in list.processes.iter().filter(|p| p.protection.is_none()) {
            assert!(p.memory_bytes.is_some(), "{} terminable without being readable as this user", p.name);
        }
    }

    #[test]
    fn sampler_measures_cpu_of_a_busy_process() {
        // `yes` writing to /dev/null pins roughly one core.
        let mut child = Command::new("/usr/bin/yes").stdout(std::process::Stdio::null()).spawn().expect("spawn yes");
        let pid = child.id() as i32;
        let mut sampler = ProcessSampler::new();
        let first = sampler.sample();
        let not_yet = first.processes.iter().find(|p| p.pid == pid).and_then(|p| p.cpu_percent);
        assert_eq!(not_yet, None, "no CPU figure before a real interval exists");
        std::thread::sleep(Duration::from_millis(300));
        let _ = sampler.sample();
        std::thread::sleep(Duration::from_millis(1500));
        let list = sampler.sample();
        let _ = child.kill();
        let _ = child.wait();
        let cpu = list.processes.iter().find(|p| p.pid == pid).and_then(|p| p.cpu_percent).expect("busy child measured");
        assert!(cpu > 50.0 && cpu < 150.0, "expected ~100% of one core, got {cpu}");
    }

    #[test]
    fn sampler_reports_real_memory_for_own_process_and_none_for_root() {
        let mut sampler = ProcessSampler::new();
        for _ in 0..2 {
            let _ = sampler.sample();
            std::thread::sleep(Duration::from_millis(250));
        }
        let list = sampler.sample();
        assert!(list.cpu_measured);
        let me = list.processes.iter().find(|p| p.pid == std::process::id() as i32).expect("own process listed");
        assert!(me.memory_bytes.unwrap_or(0) > 0);
        let launchd = list.processes.iter().find(|p| p.pid == 1).expect("launchd listed");
        assert_eq!(launchd.memory_bytes, None, "root-owned memory is unreadable and must not be reported as a number");
        assert_eq!(launchd.kind, ProcessKind::System);
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    fn cpu_secs() -> f64 {
        let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
        unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru) };
        ru.ru_utime.tv_sec as f64 + ru.ru_utime.tv_usec as f64 / 1e6 + ru.ru_stime.tv_sec as f64 + ru.ru_stime.tv_usec as f64 / 1e6
    }
    #[test]
    #[ignore]
    fn bench_refresh_cost() {
        let mut s = ProcessSampler::new();
        let _ = s.sample();
        for label in ["full sample()", "full sample() again"] {
            let c = cpu_secs();
            let w = Instant::now();
            let _ = s.sample();
            println!("{label}: cpu {:.0} ms, wall {:.0} ms", (cpu_secs() - c) * 1e3, w.elapsed().as_secs_f64() * 1e3);
        }
        let c = cpu_secs();
        s.system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu());
        println!("sysinfo cpu-only refresh: cpu {:.0} ms", (cpu_secs() - c) * 1e3);
        let c = cpu_secs();
        s.system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
        println!("sysinfo exe(OnlyIfNotSet) refresh: cpu {:.0} ms", (cpu_secs() - c) * 1e3);
        let c = cpu_secs();
        let _ = running_apps();
        println!("running_apps: cpu {:.0} ms", (cpu_secs() - c) * 1e3);
        let c = cpu_secs();
        let pids: Vec<i32> = s.system.processes().keys().map(|p| p.as_u32() as i32).collect();
        for p in &pids { let _ = phys_footprint(*p); }
        println!("rusage x{}: cpu {:.0} ms", pids.len(), (cpu_secs() - c) * 1e3);
    }
}
