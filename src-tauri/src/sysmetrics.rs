//! Low-level, read-only system metrics read straight from the kernel —
//! Mach host statistics and `sysctl` — the same sources Activity Monitor and
//! `vm_stat`/`memory_pressure`/`sysctl` read. No shell commands are parsed
//! here. Every reader returns `Option` and degrades to `None` ("Unavailable"
//! in the UI) rather than inventing a value.
//!
//! Memory is broken down the way Activity Monitor's Memory tab does it, so
//! the two can be compared side by side:
//!   - App Memory  = internal (anonymous) pages − purgeable pages
//!   - Wired       = wired pages
//!   - Compressed  = pages occupied by the compressor
//!   - Memory Used = App + Wired + Compressed
//!   - Cached Files = external (file-backed) pages + purgeable pages — memory
//!     macOS can reclaim on demand, so it is deliberately NOT counted as
//!     "used" (counting it would make a healthy Mac look nearly full).

use std::ffi::CString;
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
fn host_port() -> libc::mach_port_t {
    // `mach_host_self()` returns a send right that is never released by the
    // caller in practice — calling it on every sample would leak a port
    // right each time. Resolve it once per process.
    static HOST: OnceLock<libc::mach_port_t> = OnceLock::new();
    #[allow(deprecated)]
    *HOST.get_or_init(|| unsafe { libc::mach_host_self() })
}

fn sysctl_raw(name: &str, buf: &mut [u8]) -> Option<usize> {
    let cname = CString::new(name).ok()?;
    let mut len = buf.len();
    let rc = unsafe {
        libc::sysctlbyname(cname.as_ptr(), buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0)
    };
    (rc == 0).then_some(len)
}

pub fn sysctl_string(name: &str) -> Option<String> {
    let cname = CString::new(name).ok()?;
    let mut len: usize = 0;
    // First call sizes the buffer.
    let rc = unsafe { libc::sysctlbyname(cname.as_ptr(), std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0) };
    if rc != 0 || len == 0 {
        return None;
    }
    let mut buf = vec![0u8; len];
    let written = sysctl_raw(name, &mut buf)?;
    buf.truncate(written);
    while buf.last() == Some(&0) {
        buf.pop();
    }
    let s = String::from_utf8_lossy(&buf).trim().to_string();
    (!s.is_empty()).then_some(s)
}

pub fn sysctl_u64(name: &str) -> Option<u64> {
    let mut buf = [0u8; 8];
    let len = sysctl_raw(name, &mut buf)?;
    match len {
        8 => Some(u64::from_ne_bytes(buf)),
        4 => Some(u32::from_ne_bytes([buf[0], buf[1], buf[2], buf[3]]) as u64),
        _ => None,
    }
}

pub fn sysctl_i32(name: &str) -> Option<i32> {
    let mut buf = [0u8; 4];
    let len = sysctl_raw(name, &mut buf)?;
    (len == 4).then(|| i32::from_ne_bytes(buf))
}

pub fn page_size() -> u64 {
    let v = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if v > 0 { v as u64 } else { 4096 }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MemoryStats {
    pub total_bytes: u64,
    pub app_bytes: u64,
    pub wired_bytes: u64,
    pub compressed_bytes: u64,
    pub cached_files_bytes: u64,
    pub free_bytes: u64,
    /// Cumulative since boot — rates come from deltas between samples.
    pub swapins: u64,
    pub swapouts: u64,
}

impl MemoryStats {
    /// Activity Monitor's "Memory Used".
    pub fn used_bytes(&self) -> u64 {
        self.app_bytes + self.wired_bytes + self.compressed_bytes
    }
    /// Everything not "used" — includes reclaimable cached files.
    pub fn available_bytes(&self) -> u64 {
        self.total_bytes.saturating_sub(self.used_bytes())
    }
}

#[cfg(target_os = "macos")]
pub fn memory_stats() -> Option<MemoryStats> {
    let total_bytes = sysctl_u64("hw.memsize")?;
    let mut vm: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    let rc = unsafe {
        libc::host_statistics64(
            host_port(),
            libc::HOST_VM_INFO64,
            (&mut vm as *mut libc::vm_statistics64).cast(),
            &mut count,
        )
    };
    if rc != libc::KERN_SUCCESS {
        return None;
    }
    let page = page_size();
    let internal = vm.internal_page_count as u64;
    let purgeable = vm.purgeable_count as u64;
    Some(MemoryStats {
        total_bytes,
        app_bytes: internal.saturating_sub(purgeable) * page,
        wired_bytes: vm.wire_count as u64 * page,
        compressed_bytes: vm.compressor_page_count as u64 * page,
        cached_files_bytes: (vm.external_page_count as u64 + purgeable) * page,
        free_bytes: vm.free_count as u64 * page,
        swapins: vm.swapins,
        swapouts: vm.swapouts,
    })
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SwapStats {
    pub total_bytes: u64,
    pub used_bytes: u64,
}

pub fn swap_stats() -> Option<SwapStats> {
    let mut usage: libc::xsw_usage = unsafe { std::mem::zeroed() };
    let buf = unsafe {
        std::slice::from_raw_parts_mut((&mut usage as *mut libc::xsw_usage).cast::<u8>(), std::mem::size_of::<libc::xsw_usage>())
    };
    sysctl_raw("vm.swapusage", buf)?;
    Some(SwapStats { total_bytes: usage.xsu_total, used_bytes: usage.xsu_used })
}

/// The kernel's own memory-pressure level — the same signal that drives
/// macOS's low-memory handling (`kern.memorystatus_vm_pressure_level`):
/// 1 = normal, 2 = warning, 4 = critical.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PressureLevel {
    Normal,
    Elevated,
    Critical,
}

pub fn memory_pressure_level() -> Option<PressureLevel> {
    match sysctl_i32("kern.memorystatus_vm_pressure_level")? {
        1 => Some(PressureLevel::Normal),
        2 => Some(PressureLevel::Elevated),
        4 => Some(PressureLevel::Critical),
        _ => None,
    }
}

/// Percentage of memory the kernel considers free for new allocations
/// (`kern.memorystatus_level`) — what `memory_pressure` prints as
/// "System-wide memory free percentage".
pub fn memory_free_percent() -> Option<u32> {
    sysctl_i32("kern.memorystatus_level").filter(|v| (0..=100).contains(v)).map(|v| v as u32)
}

/// Cumulative CPU ticks since boot, summed over all cores.
#[derive(Clone, Copy, Debug, Default)]
pub struct CpuTicks {
    pub user: u64,
    pub system: u64,
    pub idle: u64,
    pub nice: u64,
}

#[cfg(target_os = "macos")]
pub fn cpu_ticks() -> Option<CpuTicks> {
    let mut info: libc::host_cpu_load_info = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_CPU_LOAD_INFO_COUNT;
    let rc = unsafe {
        libc::host_statistics(
            host_port(),
            libc::HOST_CPU_LOAD_INFO,
            (&mut info as *mut libc::host_cpu_load_info).cast(),
            &mut count,
        )
    };
    if rc != libc::KERN_SUCCESS {
        return None;
    }
    let t = info.cpu_ticks;
    Some(CpuTicks {
        user: t[libc::CPU_STATE_USER as usize] as u64,
        system: t[libc::CPU_STATE_SYSTEM as usize] as u64,
        idle: t[libc::CPU_STATE_IDLE as usize] as u64,
        nice: t[libc::CPU_STATE_NICE as usize] as u64,
    })
}

/// (user%, system%, idle%) between two tick samples. `None` when no time has
/// elapsed (the first sample has nothing to compare against).
pub fn cpu_percentages(prev: CpuTicks, cur: CpuTicks) -> Option<(f64, f64, f64)> {
    let user = cur.user.wrapping_sub(prev.user) + cur.nice.wrapping_sub(prev.nice);
    let system = cur.system.wrapping_sub(prev.system);
    let idle = cur.idle.wrapping_sub(prev.idle);
    let total = user + system + idle;
    if total == 0 {
        return None;
    }
    let pct = |v: u64| v as f64 * 100.0 / total as f64;
    Some((pct(user), pct(system), pct(idle)))
}

pub fn load_average() -> Option<[f64; 3]> {
    let mut avg = [0f64; 3];
    let n = unsafe { libc::getloadavg(avg.as_mut_ptr(), 3) };
    (n == 3).then_some(avg)
}

/// Seconds since the Unix epoch at which the kernel booted (`kern.boottime`).
pub fn boot_time_secs() -> Option<u64> {
    let mut tv: libc::timeval = unsafe { std::mem::zeroed() };
    let buf = unsafe {
        std::slice::from_raw_parts_mut((&mut tv as *mut libc::timeval).cast::<u8>(), std::mem::size_of::<libc::timeval>())
    };
    sysctl_raw("kern.boottime", buf)?;
    (tv.tv_sec > 0).then_some(tv.tv_sec as u64)
}

pub fn uptime_secs() -> Option<u64> {
    let boot = boot_time_secs()?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(now.saturating_sub(boot))
}

pub fn physical_cores() -> Option<u32> {
    sysctl_i32("hw.physicalcpu").filter(|v| *v > 0).map(|v| v as u32)
}

pub fn logical_cores() -> Option<u32> {
    sysctl_i32("hw.logicalcpu").filter(|v| *v > 0).map(|v| v as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_breakdown_is_internally_consistent() {
        let m = memory_stats().expect("host_statistics64 must succeed on macOS");
        assert!(m.total_bytes > 0);
        assert!(m.used_bytes() <= m.total_bytes, "used {} > total {}", m.used_bytes(), m.total_bytes);
        assert_eq!(m.used_bytes() + m.available_bytes(), m.total_bytes);
    }

    #[test]
    fn cpu_percentages_sum_to_100() {
        // Δuser 60 + Δnice 20 = 80, Δsystem 20, Δidle 100 → total 200.
        let a = CpuTicks { user: 100, system: 50, idle: 800, nice: 0 };
        let b = CpuTicks { user: 160, system: 70, idle: 900, nice: 20 };
        let (u, s, i) = cpu_percentages(a, b).unwrap();
        assert!((u + s + i - 100.0).abs() < 1e-9);
        assert!((u - 40.0).abs() < 1e-9, "nice time counts as user time");
        assert!((s - 10.0).abs() < 1e-9);
        assert!(cpu_percentages(a, a).is_none());
    }

    #[test]
    fn kernel_sources_resolve() {
        assert!(cpu_ticks().is_some());
        assert!(swap_stats().is_some());
        assert!(memory_pressure_level().is_some());
        assert!(boot_time_secs().is_some());
        assert!(logical_cores().unwrap() >= physical_cores().unwrap());
        assert!(sysctl_string("kern.osproductversion").is_some());
    }
}
