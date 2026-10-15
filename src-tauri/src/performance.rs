//! Live performance monitoring + local, sustained-condition alerts.
//!
//! One background sampler thread, paced by what's actually needed:
//!   - Performance screen visible  → every `refreshIntervalMs` (≈2s default)
//!   - not visible, alerts enabled → every `BACKGROUND_INTERVAL` (15s)
//!   - monitoring off, or nothing needs it → parked (no sampling at all)
//! "Visible" is a heartbeat: the frontend pings while the screen is mounted
//! and its timers run. A hidden/minimized window throttles WebView timers,
//! the pings stop, and sampling automatically drops to the background pace.
//! The thread dies with the app process — nothing keeps running after quit.
//!
//! Alerts are deliberately conservative (see `evaluate_alerts`):
//!   - every condition must hold continuously for a sensitivity-dependent
//!     window before it counts — a momentary spike never alerts;
//!   - an app's memory only counts when the *system* is also under memory
//!     pressure — high RAM use on its own is not a problem on macOS;
//!   - each alert key has a cooldown, so a persisting condition notifies once
//!     per cooldown window, not every sample;
//!   - nothing is ever terminated automatically. Alerts only inform.
//! Notifications are posted through `native_notifications::send` (the same
//! UNUserNotificationCenter path scheduled scans use), entirely locally.

use crate::processes::{ProcessDto, ProcessKind, ProcessListDto, ProcessSampler};
use crate::sysmetrics::{self, CpuTicks, MemoryStats, PressureLevel};
use crate::{device_health, disk, native_notifications};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

const BACKGROUND_INTERVAL: Duration = Duration::from_secs(15);
const VIEW_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);
const SLOW_METRICS_INTERVAL: Duration = Duration::from_secs(30);
const HISTORY_CAP: usize = 150;
const ROUTE: &str = "/performance";

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct MonitorConfig {
    pub enabled: bool,
    pub refresh_interval_ms: u64,
    /// The app-wide notifications master switch (settings.notificationsEnabled).
    pub notifications_enabled: bool,
    pub memory_alert: bool,
    pub cpu_alert: bool,
    pub app_alert: bool,
    pub storage_alert: bool,
    pub battery_alert: bool,
    /// "low" | "balanced" | "high"
    pub sensitivity: String,
    pub cpu_threshold_percent: f64,
    pub app_memory_threshold_bytes: u64,
    pub storage_free_threshold_bytes: u64,
    pub cooldown_minutes: u64,
    /// Localized notification templates from the frontend's i18n catalog,
    /// with `{app}`, `{size}`, `{percent}`, `{minutes}`, `{level}`,
    /// `{condition}` placeholders. Missing keys fall back to English.
    pub text: HashMap<String, String>,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            refresh_interval_ms: 2000,
            notifications_enabled: true,
            memory_alert: true,
            cpu_alert: true,
            app_alert: true,
            storage_alert: true,
            battery_alert: false,
            sensitivity: "balanced".into(),
            cpu_threshold_percent: 85.0,
            app_memory_threshold_bytes: 4_000_000_000,
            storage_free_threshold_bytes: 10_000_000_000,
            cooldown_minutes: 30,
            text: HashMap::new(),
        }
    }
}

impl MonitorConfig {
    fn any_alert(&self) -> bool {
        self.memory_alert || self.cpu_alert || self.app_alert || self.storage_alert || self.battery_alert
    }
    fn sustain(&self) -> Duration {
        Duration::from_secs(match self.sensitivity.as_str() {
            "low" => 300,
            "high" => 45,
            _ => 120,
        })
    }
    fn pressure_trigger(&self) -> PressureLevel {
        if self.sensitivity == "low" { PressureLevel::Critical } else { PressureLevel::Elevated }
    }
    /// Swap-outs (pages/s) that count as heavy swapping while under pressure.
    fn swapout_rate_trigger(&self) -> f64 {
        match self.sensitivity.as_str() {
            "low" => 512.0,
            "high" => 128.0,
            _ => 256.0,
        }
    }
    fn cooldown(&self) -> Duration {
        Duration::from_secs(self.cooldown_minutes.clamp(5, 24 * 60) * 60)
    }
    fn template(&self, key: &str) -> String {
        self.text.get(key).cloned().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| default_text(key).to_string())
    }
}

fn default_text(key: &str) -> &'static str {
    match key {
        "memoryTitle" => "High memory pressure",
        "memoryBody" => "Your Mac is experiencing {level} memory pressure.",
        "swapBody" => "Your Mac is swapping memory to disk heavily. Quitting unused apps may help.",
        "appMemoryTitle" => "High app memory usage",
        "appMemoryBody" => "{app} is currently using {size} of memory. Your Mac is experiencing elevated memory pressure.",
        "cpuTitle" => "Sustained high CPU usage",
        "cpuBody" => "CPU usage has stayed above {percent}% for {minutes} minutes.",
        "appCpuTitle" => "App using a lot of CPU",
        "appCpuBody" => "{app} has used about {percent}% CPU for {minutes} minutes.",
        "storageTitle" => "Storage almost full",
        "storageBody" => "Only {size} of storage is available.",
        "batteryTitle" => "Battery condition",
        "batteryBody" => "macOS reports your battery condition as \"{condition}\".",
        "levelElevated" => "elevated",
        "levelCritical" => "critical",
        _ => "",
    }
}

fn fill(template: &str, vars: &[(&str, String)]) -> String {
    let mut out = template.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

fn format_gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1e9)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDto {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub app_bytes: u64,
    pub wired_bytes: u64,
    pub compressed_bytes: u64,
    pub cached_files_bytes: u64,
    pub free_bytes: u64,
    pub available_bytes: u64,
    pub used_percent: f64,
    pub pressure: Option<PressureLevel>,
    pub free_percent: Option<u32>,
    pub swap_total_bytes: Option<u64>,
    pub swap_used_bytes: Option<u64>,
    pub swap_ins_per_sec: Option<f64>,
    pub swap_outs_per_sec: Option<f64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CpuDto {
    pub usage_percent: Option<f64>,
    pub user_percent: Option<f64>,
    pub system_percent: Option<f64>,
    pub idle_percent: Option<f64>,
    pub physical_cores: Option<u32>,
    pub logical_cores: Option<u32>,
    pub load_average: Option<[f64; 3]>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatteryBriefDto {
    pub present: bool,
    pub percent: Option<i64>,
    pub is_charging: Option<bool>,
    pub power_source: Option<String>,
    pub low_power_mode: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemDto {
    pub process_count: Option<u32>,
    pub app_count: Option<u32>,
    pub background_count: Option<u32>,
    pub system_count: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_free_bytes: u64,
    pub disk_read_bytes_per_sec: Option<f64>,
    pub disk_write_bytes_per_sec: Option<f64>,
    pub battery: Option<BatteryBriefDto>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPointDto {
    pub t: u64,
    pub memory_percent: f64,
    pub cpu_percent: Option<f64>,
    pub swap_used_bytes: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAlertDto {
    /// "memoryPressure" | "swap" | "appMemory" | "cpu" | "appCpu" | "storage" | "battery"
    pub kind: String,
    pub level: Option<PressureLevel>,
    pub app_name: Option<String>,
    pub pid: Option<i32>,
    pub bytes: Option<u64>,
    pub percent: Option<f64>,
    pub condition: Option<String>,
    pub since_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshotDto {
    pub monitoring: bool,
    pub interval_ms: u64,
    pub sampled_at_ms: u64,
    pub memory: Option<MemoryDto>,
    pub cpu: CpuDto,
    pub system: SystemDto,
    pub history: Vec<HistoryPointDto>,
    pub alerts: Vec<ActiveAlertDto>,
    pub last_notification_error: Option<String>,
}

struct SlowMetrics {
    at: Instant,
    disk: crate::dto::SystemOverviewDto,
    battery: BatteryBriefDto,
    battery_condition: Option<String>,
}

#[derive(Default)]
struct AlertState {
    /// When each currently-true condition first became true.
    since: HashMap<String, (Instant, u64)>,
    last_sent: HashMap<String, Instant>,
    /// Keys already logged as sustained (so the log gets one line per episode).
    announced: std::collections::HashSet<String>,
}

struct Inner {
    config: MonitorConfig,
    /// False until the frontend has sent the user's real settings — the
    /// background thread never samples (or alerts) on defaults.
    configured: bool,
    view_active: bool,
    last_view_ping: Option<Instant>,
    processes_wanted_until: Option<Instant>,
    sampler: ProcessSampler,
    prev_ticks: Option<CpuTicks>,
    prev_mem: Option<(MemoryStats, Instant)>,
    history: VecDeque<HistoryPointDto>,
    slow: Option<SlowMetrics>,
    last_snapshot: Option<(PerformanceSnapshotDto, Instant)>,
    last_processes: Option<(ProcessListDto, Instant)>,
    alerts: AlertState,
    last_notification_error: Option<String>,
}

struct Shared {
    inner: Mutex<Inner>,
    wake: Condvar,
}

fn shared() -> &'static Arc<Shared> {
    static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();
    SHARED.get_or_init(|| {
        Arc::new(Shared {
            inner: Mutex::new(Inner {
                config: MonitorConfig::default(),
                configured: false,
                view_active: false,
                last_view_ping: None,
                processes_wanted_until: None,
                sampler: ProcessSampler::new(),
                prev_ticks: None,
                prev_mem: None,
                history: VecDeque::with_capacity(HISTORY_CAP),
                slow: None,
                last_snapshot: None,
                last_processes: None,
                alerts: AlertState::default(),
                last_notification_error: None,
            }),
            wake: Condvar::new(),
        })
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Inner {
    fn view_visible(&self) -> bool {
        self.view_active && self.last_view_ping.map(|t| t.elapsed() < VIEW_HEARTBEAT_TIMEOUT).unwrap_or(false)
    }

    fn processes_wanted(&self) -> bool {
        self.processes_wanted_until.map(|t| Instant::now() < t).unwrap_or(false)
    }

    /// `None` = nothing needs sampling right now; park.
    fn next_interval(&self) -> Option<Duration> {
        if !self.configured || !self.config.enabled {
            return None;
        }
        if self.view_visible() {
            return Some(Duration::from_millis(self.config.refresh_interval_ms.clamp(1000, 10_000)));
        }
        self.config.any_alert().then_some(BACKGROUND_INTERVAL)
    }

    fn interval_ms(&self) -> u64 {
        self.next_interval().map(|d| d.as_millis() as u64).unwrap_or(0)
    }

    fn sample(&mut self) -> Vec<(String, String)> {
        let now = Instant::now();
        let mem = sysmetrics::memory_stats();
        let swap = sysmetrics::swap_stats();
        let pressure = sysmetrics::memory_pressure_level();
        let ticks = sysmetrics::cpu_ticks();
        let cpu_split = match (self.prev_ticks, ticks) {
            (Some(prev), Some(cur)) => sysmetrics::cpu_percentages(prev, cur),
            _ => None,
        };
        if ticks.is_some() {
            self.prev_ticks = ticks;
        }

        let (swap_in_rate, swap_out_rate) = match (mem, self.prev_mem) {
            (Some(m), Some((pm, pt))) => {
                let dt = now.duration_since(pt).as_secs_f64();
                if dt > 0.0 {
                    (
                        Some(m.swapins.saturating_sub(pm.swapins) as f64 / dt),
                        Some(m.swapouts.saturating_sub(pm.swapouts) as f64 / dt),
                    )
                } else {
                    (None, None)
                }
            }
            _ => (None, None),
        };
        if let Some(m) = mem {
            self.prev_mem = Some((m, now));
        }

        if self.slow.as_ref().map(|s| s.at.elapsed() >= SLOW_METRICS_INTERVAL).unwrap_or(true) {
            let b = device_health::battery();
            self.slow = Some(SlowMetrics {
                at: now,
                disk: disk::get_system_overview(),
                battery_condition: b.present.then(|| b.condition.clone()).flatten(),
                battery: BatteryBriefDto {
                    present: b.present,
                    percent: b.percent,
                    is_charging: b.is_charging,
                    power_source: b.power_source,
                    low_power_mode: b.low_power_mode,
                },
            });
        }

        // The process table is the only expensive part of a sample. In the
        // background it is scanned only when an app-level alert is even
        // possible: app-memory alerts require system memory pressure, and a
        // single process pinning a core implies overall CPU of at least one
        // core's share. Otherwise sampling is just a few kernel counters.
        let cpu_now = cpu_split.map(|(u, s, _)| u + s);
        let one_core_share = 100.0 / sysmetrics::logical_cores().unwrap_or(1).max(1) as f64;
        let app_alert_possible = self.config.app_alert
            && (pressure.map(|p| p >= PressureLevel::Elevated).unwrap_or(false) || cpu_now.map(|c| c >= one_core_share * 0.8).unwrap_or(true));
        let need_processes = self.processes_wanted() || self.view_visible() || app_alert_possible;
        if need_processes {
            let list = self.sampler.sample();
            self.last_processes = Some((list, now));
        }
        let procs = self.last_processes.as_ref().filter(|(_, t)| t.elapsed() < BACKGROUND_INTERVAL * 2).map(|(l, _)| l);

        let memory = mem.map(|m| MemoryDto {
            total_bytes: m.total_bytes,
            used_bytes: m.used_bytes(),
            app_bytes: m.app_bytes,
            wired_bytes: m.wired_bytes,
            compressed_bytes: m.compressed_bytes,
            cached_files_bytes: m.cached_files_bytes,
            free_bytes: m.free_bytes,
            available_bytes: m.available_bytes(),
            used_percent: if m.total_bytes > 0 { m.used_bytes() as f64 * 100.0 / m.total_bytes as f64 } else { 0.0 },
            pressure,
            free_percent: sysmetrics::memory_free_percent(),
            swap_total_bytes: swap.map(|s| s.total_bytes),
            swap_used_bytes: swap.map(|s| s.used_bytes),
            swap_ins_per_sec: swap_in_rate,
            swap_outs_per_sec: swap_out_rate,
        });
        let cpu = CpuDto {
            usage_percent: cpu_split.map(|(u, s, _)| u + s),
            user_percent: cpu_split.map(|(u, _, _)| u),
            system_percent: cpu_split.map(|(_, s, _)| s),
            idle_percent: cpu_split.map(|(_, _, i)| i),
            physical_cores: sysmetrics::physical_cores(),
            logical_cores: sysmetrics::logical_cores(),
            load_average: sysmetrics::load_average(),
        };
        let slow = self.slow.as_ref().expect("populated above");
        let system = SystemDto {
            process_count: procs.map(|p| p.total_count),
            app_count: procs.map(|p| p.app_count),
            background_count: procs.map(|p| p.background_count),
            system_count: procs.map(|p| p.system_count),
            uptime_secs: sysmetrics::uptime_secs(),
            disk_total_bytes: slow.disk.total_bytes,
            disk_used_bytes: slow.disk.used_bytes,
            disk_free_bytes: slow.disk.free_bytes,
            disk_read_bytes_per_sec: procs.and_then(|p| p.disk_read_bytes_per_sec),
            disk_write_bytes_per_sec: procs.and_then(|p| p.disk_write_bytes_per_sec),
            battery: Some(slow.battery.clone()),
        };

        if let Some(m) = &memory {
            if self.history.len() >= HISTORY_CAP {
                self.history.pop_front();
            }
            self.history.push_back(HistoryPointDto {
                t: now_ms(),
                memory_percent: m.used_percent,
                cpu_percent: cpu.usage_percent,
                swap_used_bytes: m.swap_used_bytes,
            });
        }

        let inputs = AlertInputs {
            pressure,
            swap_out_rate,
            cpu_usage: cpu.usage_percent,
            processes: procs.map(|p| p.processes.as_slice()).unwrap_or(&[]),
            disk_free: slow.disk.free_bytes,
            disk_total: slow.disk.total_bytes,
            battery_condition: slow.battery_condition.clone(),
        };
        let (active, to_send) = evaluate_alerts(&self.config, &mut self.alerts, &inputs, now);

        let snapshot = PerformanceSnapshotDto {
            monitoring: self.config.enabled,
            interval_ms: self.interval_ms(),
            sampled_at_ms: now_ms(),
            memory,
            cpu,
            system,
            history: self.history.iter().cloned().collect(),
            alerts: active,
            last_notification_error: self.last_notification_error.clone(),
        };
        self.last_snapshot = Some((snapshot, now));
        to_send
    }
}

struct AlertInputs<'a> {
    pressure: Option<PressureLevel>,
    swap_out_rate: Option<f64>,
    cpu_usage: Option<f64>,
    processes: &'a [ProcessDto],
    disk_free: u64,
    disk_total: u64,
    battery_condition: Option<String>,
}

/// Returns (currently sustained conditions for the in-app banner,
/// notifications to post now). Pure apart from `state` — unit tested below.
fn evaluate_alerts(
    config: &MonitorConfig,
    state: &mut AlertState,
    input: &AlertInputs,
    now: Instant,
) -> (Vec<ActiveAlertDto>, Vec<(String, String)>) {
    let sustain = config.sustain();
    // (key, condition true?, required duration, alert payload, notification (title, body), cooldown)
    let mut candidates: Vec<(String, Duration, ActiveAlertDto, (String, String), Duration)> = Vec::new();
    let level_text = |l: PressureLevel| match l {
        PressureLevel::Critical => config.template("levelCritical"),
        _ => config.template("levelElevated"),
    };
    let blank = |kind: &str| ActiveAlertDto {
        kind: kind.into(),
        level: None,
        app_name: None,
        pid: None,
        bytes: None,
        percent: None,
        condition: None,
        since_ms: 0,
    };
    let under_pressure = input.pressure.map(|p| p >= PressureLevel::Elevated).unwrap_or(false);

    if config.memory_alert {
        if let Some(level) = input.pressure.filter(|p| *p >= config.pressure_trigger()) {
            candidates.push((
                "memoryPressure".into(),
                sustain,
                ActiveAlertDto { level: Some(level), ..blank("memoryPressure") },
                (config.template("memoryTitle"), fill(&config.template("memoryBody"), &[("level", level_text(level))])),
                config.cooldown(),
            ));
        }
        if under_pressure && input.swap_out_rate.map(|r| r >= config.swapout_rate_trigger()).unwrap_or(false) {
            candidates.push((
                "swap".into(),
                sustain,
                ActiveAlertDto { level: input.pressure, ..blank("swap") },
                (config.template("memoryTitle"), config.template("swapBody")),
                config.cooldown(),
            ));
        }
    }

    // Only real, user-facing apps (grouped with their helpers) — and only
    // while the system itself is under memory pressure.
    if config.app_alert && under_pressure {
        for p in input.processes.iter().filter(|p| p.kind == ProcessKind::App) {
            let Some(bytes) = p.group_memory_bytes else { continue };
            if bytes < config.app_memory_threshold_bytes {
                continue;
            }
            let id = p.bundle_id.clone().unwrap_or_else(|| p.name.clone());
            candidates.push((
                format!("appMemory:{id}"),
                sustain,
                ActiveAlertDto { app_name: Some(p.name.clone()), pid: Some(p.pid), bytes: Some(bytes), level: input.pressure, ..blank("appMemory") },
                (
                    config.template("appMemoryTitle"),
                    fill(&config.template("appMemoryBody"), &[("app", p.name.clone()), ("size", format_gb(bytes))]),
                ),
                config.cooldown(),
            ));
        }
    }

    if config.cpu_alert {
        if let Some(usage) = input.cpu_usage.filter(|u| *u >= config.cpu_threshold_percent) {
            candidates.push((
                "cpu".into(),
                sustain,
                ActiveAlertDto { percent: Some(usage), ..blank("cpu") },
                (
                    config.template("cpuTitle"),
                    fill(
                        &config.template("cpuBody"),
                        &[("percent", format!("{:.0}", config.cpu_threshold_percent)), ("minutes", format!("{}", (sustain.as_secs() / 60).max(1)))],
                    ),
                ),
                config.cooldown(),
            ));
        }
    }

    if config.app_alert {
        // A single user process pinning ~a full core for twice the sustain window.
        let app_sustain = sustain * 2;
        for p in input.processes.iter().filter(|p| p.kind != ProcessKind::System && !p.is_app_helper) {
            let Some(cpu) = p.group_cpu_percent.filter(|c| *c >= 80.0) else { continue };
            let id = p.bundle_id.clone().unwrap_or_else(|| format!("{}:{}", p.name, p.pid));
            candidates.push((
                format!("appCpu:{id}"),
                app_sustain,
                ActiveAlertDto { app_name: Some(p.name.clone()), pid: Some(p.pid), percent: Some(cpu as f64), ..blank("appCpu") },
                (
                    config.template("appCpuTitle"),
                    fill(
                        &config.template("appCpuBody"),
                        &[("app", p.name.clone()), ("percent", format!("{cpu:.0}")), ("minutes", format!("{}", (app_sustain.as_secs() / 60).max(1)))],
                    ),
                ),
                config.cooldown(),
            ));
        }
    }

    if config.storage_alert && input.disk_total > 0 && input.disk_free < config.storage_free_threshold_bytes {
        candidates.push((
            "storage".into(),
            Duration::ZERO,
            ActiveAlertDto { bytes: Some(input.disk_free), ..blank("storage") },
            (config.template("storageTitle"), fill(&config.template("storageBody"), &[("size", format_gb(input.disk_free))])),
            config.cooldown().max(Duration::from_secs(6 * 3600)),
        ));
    }

    if config.battery_alert {
        if let Some(condition) = input.battery_condition.clone().filter(|c| c != "Normal") {
            candidates.push((
                "battery".into(),
                Duration::ZERO,
                ActiveAlertDto { condition: Some(condition.clone()), ..blank("battery") },
                (config.template("batteryTitle"), fill(&config.template("batteryBody"), &[("condition", condition)])),
                Duration::from_secs(24 * 3600),
            ));
        }
    }

    // Forget conditions that are no longer true (their sustain timer resets).
    let live: std::collections::HashSet<&String> = candidates.iter().map(|c| &c.0).collect();
    state.since.retain(|k, _| live.contains(k));
    state.announced.retain(|k| live.contains(k));

    let mut active = Vec::new();
    let mut to_send = Vec::new();
    for (key, required, mut alert, notification, cooldown) in candidates {
        let (started, started_ms) = *state.since.entry(key.clone()).or_insert((now, now_ms()));
        if now.duration_since(started) < required {
            continue;
        }
        alert.since_ms = started_ms;
        if !state.announced.contains(&key) {
            log::info!("[performance] condition sustained: {key}");
            state.announced.insert(key.clone());
        }
        active.push(alert);
        let cooled = state.last_sent.get(&key).map(|t| now.duration_since(*t) >= cooldown).unwrap_or(true);
        if config.notifications_enabled && cooled {
            state.last_sent.insert(key, now);
            to_send.push(notification);
        }
    }
    (active, to_send)
}

fn post(notifications: Vec<(String, String)>) {
    for (title, body) in notifications {
        let ok = native_notifications::send(&title, &body, ROUTE);
        // Local app log only (~/Library/Logs/com.macstoragemanager.app/).
        log::info!("[performance] alert notification {}: {title} — {body}", if ok { "posted" } else { "NOT posted" });
        // Resolved before taking the lock — the status query can wait on the
        // notification daemon for up to 3s.
        let error = if ok {
            None
        } else if native_notifications::authorization_status().is_none() {
            Some("unavailable".to_string())
        } else {
            Some("failed".to_string())
        };
        shared().inner.lock().unwrap().last_notification_error = error;
    }
}

/// Starts the sampler thread (idempotent). Called once from app setup.
pub fn start() {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    let shared = shared().clone();
    let spawned = std::thread::Builder::new().name("performance-monitor".into()).spawn(move || loop {
        let mut inner = shared.inner.lock().unwrap();
        match inner.next_interval() {
            None => {
                // Parked: nothing samples until config/visibility changes.
                drop(shared.wake.wait(inner).unwrap());
            }
            Some(interval) => {
                let due = inner.last_snapshot.as_ref().map(|(_, t)| t.elapsed() >= interval).unwrap_or(true);
                if due {
                    let to_send = inner.sample();
                    drop(inner);
                    if !to_send.is_empty() {
                        post(to_send);
                    }
                    inner = shared.inner.lock().unwrap();
                }
                let wait = inner
                    .last_snapshot
                    .as_ref()
                    .map(|(_, t)| interval.saturating_sub(t.elapsed()))
                    .unwrap_or(interval)
                    .max(Duration::from_millis(200));
                drop(shared.wake.wait_timeout(inner, wait).unwrap());
            }
        }
    });
    if let Err(e) = spawned {
        log::warn!("[performance] could not start monitor thread: {e}");
    }
}

pub fn configure(config: MonitorConfig) {
    log::info!(
        "[performance] monitor configured: enabled={} notifications={} memory={} cpu={} app={} storage={} battery={} sensitivity={} cooldown={}min",
        config.enabled,
        config.notifications_enabled,
        config.memory_alert,
        config.cpu_alert,
        config.app_alert,
        config.storage_alert,
        config.battery_alert,
        config.sensitivity,
        config.cooldown_minutes
    );
    let mut inner = shared().inner.lock().unwrap();
    if !config.enabled {
        inner.alerts.since.clear();
    }
    inner.config = config;
    inner.configured = true;
    shared().wake.notify_all();
}

pub fn set_view_active(active: bool) {
    let mut inner = shared().inner.lock().unwrap();
    inner.view_active = active;
    inner.last_view_ping = active.then(Instant::now);
    shared().wake.notify_all();
}

/// Latest snapshot. Also the view heartbeat. Samples inline when the cached
/// one is stale so the screen never opens on old data.
pub fn snapshot() -> Option<PerformanceSnapshotDto> {
    let to_send;
    let result;
    {
        let mut inner = shared().inner.lock().unwrap();
        if inner.view_active {
            inner.last_view_ping = Some(Instant::now());
        }
        if !inner.config.enabled {
            return None;
        }
        let interval = Duration::from_millis(inner.config.refresh_interval_ms.clamp(1000, 10_000));
        let stale = inner.last_snapshot.as_ref().map(|(_, t)| t.elapsed() >= interval).unwrap_or(true);
        to_send = if stale { inner.sample() } else { Vec::new() };
        let interval_ms = inner.interval_ms();
        result = inner.last_snapshot.as_ref().map(|(s, _)| PerformanceSnapshotDto { interval_ms, ..s.clone() });
        shared().wake.notify_all();
    }
    if !to_send.is_empty() {
        std::thread::spawn(move || post(to_send));
    }
    result
}

/// Running processes (fresh within the refresh interval). Marks the process
/// table as wanted so the sampler keeps refreshing it while it's on screen.
pub fn processes() -> ProcessListDto {
    let mut inner = shared().inner.lock().unwrap();
    let interval = Duration::from_millis(inner.config.refresh_interval_ms.clamp(1000, 10_000));
    inner.processes_wanted_until = Some(Instant::now() + VIEW_HEARTBEAT_TIMEOUT);
    let fresh = inner.last_processes.as_ref().map(|(_, t)| t.elapsed() < interval).unwrap_or(false);
    if !fresh {
        let list = inner.sampler.sample();
        inner.last_processes = Some((list, Instant::now()));
    }
    shared().wake.notify_all();
    inner.last_processes.as_ref().map(|(l, _)| l.clone()).expect("sampled above")
}

/// Test notification through the exact same native path real alerts use.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestNotificationResultDto {
    /// "sent" | "denied" | "unavailable" | "failed"
    pub outcome: String,
    pub authorization: Option<String>,
}

pub fn authorization_label(raw: Option<i64>) -> String {
    match raw {
        Some(0) => "notDetermined",
        Some(1) => "denied",
        Some(2) => "authorized",
        Some(3) => "provisional",
        Some(4) => "ephemeral",
        Some(_) => "unknown",
        None => "unavailable",
    }
    .to_string()
}

pub fn send_test_notification(title: &str, body: &str) -> TestNotificationResultDto {
    let mut status = native_notifications::authorization_status();
    if status == Some(0) {
        native_notifications::request_authorization_blocking();
        status = native_notifications::authorization_status();
    }
    let outcome = match status {
        None => "unavailable",
        Some(1) => "denied",
        Some(_) => {
            if native_notifications::send(title, body, ROUTE) { "sent" } else { "failed" }
        }
    };
    TestNotificationResultDto { outcome: outcome.into(), authorization: Some(authorization_label(status)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, mem: u64, cpu: f32) -> ProcessDto {
        ProcessDto {
            pid: 4242,
            parent_pid: Some(1),
            name: name.into(),
            bundle_id: Some(format!("com.example.{name}")),
            path: Some(format!("/Applications/{name}.app/Contents/MacOS/{name}")),
            memory_bytes: Some(mem),
            group_memory_bytes: Some(mem),
            group_cpu_percent: Some(cpu),
            helper_count: 0,
            cpu_percent: Some(cpu),
            kind: ProcessKind::App,
            status: None,
            is_hidden: None,
            is_active: None,
            start_time: 0,
            user: None,
            protection: None,
            is_app_helper: false,
        }
    }

    fn inputs<'a>(pressure: PressureLevel, cpu: f64, procs: &'a [ProcessDto]) -> AlertInputs<'a> {
        AlertInputs {
            pressure: Some(pressure),
            swap_out_rate: Some(0.0),
            cpu_usage: Some(cpu),
            processes: procs,
            disk_free: 100_000_000_000,
            disk_total: 500_000_000_000,
            battery_condition: Some("Normal".into()),
        }
    }

    #[test]
    fn momentary_spike_does_not_alert_but_sustained_condition_does() {
        let config = MonitorConfig::default();
        let mut state = AlertState::default();
        let t0 = Instant::now();
        let (active, send) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Elevated, 10.0, &[]), t0);
        assert!(active.is_empty() && send.is_empty(), "must not alert on the first sample");
        let (active, send) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Elevated, 10.0, &[]), t0 + Duration::from_secs(121));
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].kind, "memoryPressure");
        assert_eq!(send.len(), 1);
    }

    #[test]
    fn condition_clearing_resets_the_sustain_timer() {
        let config = MonitorConfig::default();
        let mut state = AlertState::default();
        let t0 = Instant::now();
        evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Elevated, 10.0, &[]), t0);
        evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Normal, 10.0, &[]), t0 + Duration::from_secs(60));
        let (active, _) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Elevated, 10.0, &[]), t0 + Duration::from_secs(130));
        assert!(active.is_empty(), "flapping must not satisfy the sustain window");
    }

    #[test]
    fn cooldown_prevents_repeat_notifications() {
        let config = MonitorConfig::default();
        let mut state = AlertState::default();
        let t0 = Instant::now();
        let mut sent = 0;
        for i in 0..200u64 {
            let (_, s) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Critical, 10.0, &[]), t0 + Duration::from_secs(i * 15));
            sent += s.len();
        }
        // 50 minutes of continuous critical pressure, 30-minute cooldown → exactly 2.
        assert_eq!(sent, 2);
    }

    #[test]
    fn high_app_memory_alone_is_not_a_problem() {
        let config = MonitorConfig::default();
        let mut state = AlertState::default();
        let procs = [app("Chrome", 8_000_000_000, 5.0)];
        let t0 = Instant::now();
        for i in 0..20u64 {
            let (active, send) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Normal, 10.0, &procs), t0 + Duration::from_secs(i * 30));
            assert!(active.is_empty() && send.is_empty());
        }
        // Same app, now with real system pressure, sustained → alert with the app named.
        let mut state = AlertState::default();
        let mut found = None;
        for i in 0..10u64 {
            let (active, _) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Elevated, 10.0, &procs), t0 + Duration::from_secs(i * 30));
            found = active.into_iter().find(|a| a.kind == "appMemory").or(found);
        }
        let alert = found.expect("sustained pressure + large app should alert");
        assert_eq!(alert.app_name.as_deref(), Some("Chrome"));
    }

    #[test]
    fn notifications_master_switch_suppresses_sending_not_detection() {
        let config = MonitorConfig { notifications_enabled: false, ..Default::default() };
        let mut state = AlertState::default();
        let t0 = Instant::now();
        evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Critical, 10.0, &[]), t0);
        let (active, send) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Critical, 10.0, &[]), t0 + Duration::from_secs(200));
        assert_eq!(active.len(), 1);
        assert!(send.is_empty());
    }

    #[test]
    fn localized_templates_are_used_with_english_fallback() {
        let mut config = MonitorConfig::default();
        config.text.insert("memoryBody".into(), "Arbeitsspeicherdruck: {level}".into());
        config.text.insert("levelCritical".into(), "kritisch".into());
        let mut state = AlertState::default();
        let t0 = Instant::now();
        evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Critical, 10.0, &[]), t0);
        let (_, send) = evaluate_alerts(&config, &mut state, &inputs(PressureLevel::Critical, 10.0, &[]), t0 + Duration::from_secs(200));
        assert_eq!(send[0].1, "Arbeitsspeicherdruck: kritisch");
        assert_eq!(send[0].0, "High memory pressure");
    }
}
