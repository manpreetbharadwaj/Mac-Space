//! Mac Health: hardware identity, storage volumes, and battery condition,
//! read from sysctl, IOKit/IOPowerSources, Foundation and the existing disk
//! overview (disk.rs). Every field is `Option` — "Unavailable" in the UI —
//! whenever macOS doesn't expose it; nothing here is estimated or hardcoded.
//!
//! Privacy: the serial number is deliberately NOT part of `DeviceInfoDto`.
//! It is only returned by `serial_number()`, which the UI calls when the user
//! explicitly clicks "Reveal", and it is never logged.

use crate::{disk, iokit, sysmetrics};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GpuDto {
    pub model: String,
    pub core_count: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfoDto {
    /// e.g. "MacBook Pro (13-inch, M1, 2020)" — from the device tree on Apple
    /// Silicon, or System Information's own cached name on Intel.
    pub model_name: Option<String>,
    /// e.g. "MacBookPro17,1".
    pub model_identifier: Option<String>,
    /// Regulatory model number (e.g. "A2338"), when the device tree has it.
    pub model_number: Option<String>,
    pub serial_available: bool,
    /// "appleSilicon" | "intel"
    pub processor_kind: Option<String>,
    pub chip_name: Option<String>,
    pub physical_cores: Option<u32>,
    pub logical_cores: Option<u32>,
    pub performance_cores: Option<u32>,
    pub efficiency_cores: Option<u32>,
    pub gpus: Vec<GpuDto>,
    pub memory_bytes: Option<u64>,
    pub os_version: Option<String>,
    pub os_build: Option<String>,
    /// Hardware architecture ("arm64" / "x86_64"), not this binary's.
    pub architecture: Option<String>,
    /// True when this app itself is running under Rosetta translation.
    pub running_under_rosetta: bool,
    pub uptime_secs: Option<u64>,
    pub boot_time_ms: Option<u64>,
}

fn platform_expert() -> Option<iokit::Props> {
    iokit::service_properties("IOPlatformExpertDevice")
}

/// Intel Macs have no product name in the device tree; System Information
/// caches the marketing name it resolved in this per-user plist.
fn intel_cached_model_name() -> Option<String> {
    let path = dirs::home_dir()?.join("Library/Preferences/com.apple.SystemProfiler.plist");
    let value = plist::Value::from_file(path).ok()?;
    let names = value.as_dictionary()?.get("CPU Names")?.as_dictionary()?;
    // Keyed by part of the serial number + locale; any entry is this Mac.
    names.values().find_map(|v| v.as_string().map(String::from))
}

pub fn device_info() -> DeviceInfoDto {
    let pe = platform_expert();
    let arm64 = sysmetrics::sysctl_i32("hw.optional.arm64") == Some(1);
    let product = iokit::registry_path_properties("IODeviceTree:/product");
    let model_name = product
        .as_ref()
        .and_then(|p| p.string("product-name"))
        .or_else(|| if arm64 { None } else { intel_cached_model_name() });

    let gpus = iokit::all_service_properties("IOAccelerator")
        .into_iter()
        .filter_map(|p| p.string("model").map(|model| GpuDto { model, core_count: p.i64("gpu-core-count") }))
        .collect::<Vec<_>>();
    // Intel/AMD GPUs publish their name on the PCI device instead.
    let gpus = if gpus.is_empty() {
        iokit::all_service_properties("IOPCIDevice")
            .into_iter()
            .filter(|p| p.string("IOName").as_deref() == Some("display"))
            .filter_map(|p| p.string("model").map(|model| GpuDto { model, core_count: None }))
            .collect()
    } else {
        gpus
    };

    let perf_levels = sysmetrics::sysctl_i32("hw.nperflevels").unwrap_or(0);
    let level_cores = |n: i32| -> Option<u32> {
        (perf_levels > n).then(|| sysmetrics::sysctl_i32(&format!("hw.perflevel{n}.physicalcpu"))).flatten().map(|v| v as u32)
    };

    DeviceInfoDto {
        model_name,
        model_identifier: pe.as_ref().and_then(|p| p.string("model")).or_else(|| sysmetrics::sysctl_string("hw.model")),
        model_number: product.as_ref().and_then(|p| p.string("regulatory-model-number")),
        serial_available: pe.as_ref().and_then(|p| p.string("IOPlatformSerialNumber")).is_some(),
        processor_kind: Some(if arm64 { "appleSilicon" } else { "intel" }.to_string()),
        chip_name: sysmetrics::sysctl_string("machdep.cpu.brand_string"),
        physical_cores: sysmetrics::physical_cores(),
        logical_cores: sysmetrics::logical_cores(),
        // Only Apple Silicon reports two performance levels (P and E cores).
        performance_cores: if perf_levels >= 2 { level_cores(0) } else { None },
        efficiency_cores: if perf_levels >= 2 { level_cores(1) } else { None },
        gpus,
        memory_bytes: sysmetrics::sysctl_u64("hw.memsize"),
        os_version: sysmetrics::sysctl_string("kern.osproductversion"),
        os_build: sysmetrics::sysctl_string("kern.osversion"),
        architecture: Some(if arm64 { "arm64" } else { "x86_64" }.to_string()),
        running_under_rosetta: sysmetrics::sysctl_i32("sysctl.proc_translated") == Some(1),
        uptime_secs: sysmetrics::uptime_secs(),
        boot_time_ms: sysmetrics::boot_time_secs().map(|s| s * 1000),
    }
}

/// Only called on an explicit user "Reveal" action — never logged.
pub fn serial_number() -> Option<String> {
    platform_expert()?.string("IOPlatformSerialNumber")
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VolumeDto {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub is_removable: bool,
    /// "ssd" | "hdd" | "unknown"
    pub kind: String,
    pub is_internal_startup: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InternalDiskDto {
    pub model: Option<String>,
    /// "Solid State" / "Rotational", as reported by the storage driver.
    pub medium_type: Option<String>,
    pub interconnect: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StorageHealthDto {
    pub volume_name: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub purgeable_bytes: u64,
    pub volumes: Vec<VolumeDto>,
    pub internal_disk: Option<InternalDiskDto>,
}

fn internal_disk() -> Option<InternalDiskDto> {
    iokit::all_service_properties("IOBlockStorageDevice").into_iter().find_map(|p| {
        let protocol = p.dictionary("Protocol Characteristics")?;
        if protocol.string("Physical Interconnect Location").as_deref() != Some("Internal") {
            return None;
        }
        // "Device Characteristics" also carries the SSD's own serial number —
        // deliberately not read.
        let device = p.dictionary("Device Characteristics");
        Some(InternalDiskDto {
            model: device.as_ref().and_then(|d| d.string("Product Name")),
            medium_type: device.as_ref().and_then(|d| d.string("Medium Type")),
            interconnect: protocol.string("Physical Interconnect"),
        })
    })
}

pub fn storage_health() -> StorageHealthDto {
    // Reuse the cleaner's own capacity source so both screens always agree.
    let overview = disk::get_system_overview();
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut volumes: Vec<VolumeDto> = disks
        .iter()
        .filter_map(|d| {
            let mount = d.mount_point().to_string_lossy().to_string();
            let startup = mount == "/";
            // Everything under /System/Volumes is an implementation detail of
            // the startup disk's APFS container (Data, VM, Preboot, …).
            if !startup && !mount.starts_with("/Volumes/") {
                return None;
            }
            let kind = match d.kind() {
                sysinfo::DiskKind::SSD => "ssd",
                sysinfo::DiskKind::HDD => "hdd",
                _ => "unknown",
            };
            Some(VolumeDto {
                name: if startup { overview.volume_name.clone() } else { d.name().to_string_lossy().to_string() },
                mount_point: mount,
                file_system: d.file_system().to_string_lossy().to_string(),
                total_bytes: if startup { overview.total_bytes } else { d.total_space() },
                available_bytes: if startup { overview.free_bytes } else { d.available_space() },
                is_removable: d.is_removable(),
                kind: kind.to_string(),
                is_internal_startup: startup,
            })
        })
        .collect();
    volumes.sort_by_key(|v| !v.is_internal_startup);

    StorageHealthDto {
        volume_name: overview.volume_name.clone(),
        total_bytes: overview.total_bytes,
        used_bytes: overview.used_bytes,
        available_bytes: overview.free_bytes,
        purgeable_bytes: overview.purgeable_bytes,
        volumes,
        internal_disk: internal_disk(),
    }
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryDto {
    pub present: bool,
    pub percent: Option<i64>,
    pub is_charging: Option<bool>,
    pub external_connected: Option<bool>,
    pub fully_charged: Option<bool>,
    /// "AC Power" / "Battery Power" / "UPS Power" — as IOPowerSources reports it.
    pub power_source: Option<String>,
    pub cycle_count: Option<i64>,
    /// macOS's own condition text when it reports one (e.g. "Service
    /// Recommended"); "Normal" only when IOPowerSources says the health is Good.
    pub condition: Option<String>,
    pub design_capacity_mah: Option<i64>,
    pub full_charge_capacity_mah: Option<i64>,
    /// full-charge ÷ design, only when both are reported by the battery itself.
    pub maximum_capacity_percent: Option<f64>,
    pub temperature_c: Option<f64>,
    pub time_to_empty_min: Option<i64>,
    pub time_to_full_min: Option<i64>,
    pub low_power_mode: Option<bool>,
}

pub fn low_power_mode() -> Option<bool> {
    use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};
    let info = NSProcessInfo::processInfo();
    // `isLowPowerModeEnabled` was added to macOS in 12.0; calling it on 11
    // would be an unrecognized selector.
    let v12 = NSOperatingSystemVersion { majorVersion: 12, minorVersion: 0, patchVersion: 0 };
    info.isOperatingSystemAtLeastVersion(v12).then(|| info.isLowPowerModeEnabled())
}

pub fn battery() -> BatteryDto {
    let ps = iokit::internal_battery_power_source();
    let smart = iokit::service_properties("AppleSmartBattery");
    let installed = smart.as_ref().and_then(|s| s.bool("BatteryInstalled")).unwrap_or(ps.is_some());
    if ps.is_none() && !installed {
        return BatteryDto {
            present: false,
            power_source: iokit::providing_power_source_type(),
            low_power_mode: low_power_mode(),
            ..Default::default()
        };
    }

    let design = smart.as_ref().and_then(|s| s.i64("DesignCapacity")).filter(|v| *v > 0);
    // Apple Silicon: NominalChargeCapacity is the full-charge capacity that
    // System Settings' "Maximum Capacity" is computed from (verified on a
    // real M1: 4134 / 5103 = 81%, matching System Settings exactly). Intel
    // batteries report it as AppleRawMaxCapacity / MaxCapacity in mAh.
    let full = smart.as_ref().and_then(|s| {
        s.i64("NominalChargeCapacity")
            .or_else(|| s.i64("AppleRawMaxCapacity"))
            .or_else(|| s.i64("MaxCapacity").filter(|v| *v > 100))
    });
    let max_pct = match (full, design) {
        (Some(f), Some(d)) if f > 0 => Some(((f as f64 / d as f64) * 1000.0).round() / 10.0),
        _ => None,
    };

    let ps_ref = ps.as_ref();
    let current = ps_ref.and_then(|p| p.i64("Current Capacity"));
    let max = ps_ref.and_then(|p| p.i64("Max Capacity")).filter(|v| *v > 0);
    let percent = match (current, max) {
        (Some(c), Some(m)) => Some(((c as f64 / m as f64) * 100.0).round() as i64),
        _ => None,
    };
    let condition = ps_ref
        .and_then(|p| p.string("BatteryHealthCondition"))
        .or_else(|| match ps_ref.and_then(|p| p.string("BatteryHealth")).as_deref() {
            Some("Good") => Some("Normal".to_string()),
            Some(other) => Some(other.to_string()),
            None => None,
        });
    let minutes = |key: &str| ps_ref.and_then(|p| p.i64(key)).filter(|v| *v >= 0);

    BatteryDto {
        present: true,
        percent,
        is_charging: ps_ref.and_then(|p| p.bool("Is Charging")).or_else(|| smart.as_ref().and_then(|s| s.bool("IsCharging"))),
        external_connected: smart.as_ref().and_then(|s| s.bool("ExternalConnected")),
        fully_charged: smart.as_ref().and_then(|s| s.bool("FullyCharged")).or_else(|| ps_ref.and_then(|p| p.bool("Is Charged"))),
        power_source: ps_ref.and_then(|p| p.string("Power Source State")).or_else(iokit::providing_power_source_type),
        cycle_count: smart.as_ref().and_then(|s| s.i64("CycleCount")),
        condition,
        design_capacity_mah: design,
        full_charge_capacity_mah: full,
        maximum_capacity_percent: max_pct,
        // Reported in hundredths of a degree Celsius.
        temperature_c: smart.as_ref().and_then(|s| s.i64("Temperature")).filter(|t| *t > 0).map(|t| t as f64 / 100.0),
        time_to_empty_min: minutes("Time to Empty"),
        time_to_full_min: minutes("Time to Full Charge"),
        low_power_mode: low_power_mode(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_info_reads_real_identity() {
        let d = device_info();
        assert!(d.model_identifier.is_some());
        assert!(d.chip_name.is_some());
        assert!(d.memory_bytes.unwrap_or(0) > 0);
        assert!(d.os_version.is_some() && d.os_build.is_some());
    }

    #[test]
    fn storage_health_matches_cleaner_overview() {
        let s = storage_health();
        let o = disk::get_system_overview();
        assert_eq!(s.total_bytes, o.total_bytes);
        assert!(s.volumes.iter().any(|v| v.is_internal_startup));
    }

    #[test]
    fn battery_values_are_plausible_when_present() {
        let b = battery();
        if b.present {
            if let Some(p) = b.percent {
                assert!((0..=100).contains(&p));
            }
            if let Some(m) = b.maximum_capacity_percent {
                assert!(m > 0.0 && m < 150.0);
            }
        }
    }
}
