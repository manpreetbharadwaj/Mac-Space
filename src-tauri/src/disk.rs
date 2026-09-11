use crate::dto::SystemOverviewDto;
use sysinfo::Disks;

/// macOS's own Storage settings pane is built on `NSURLResourceValues`, not
/// raw `statfs`. In particular it uses
/// `NSURLVolumeAvailableCapacityForImportantUsageKey` for "available" —
/// which factors in purgeable space (local snapshots, evictable caches) the
/// same way macOS itself does — rather than the stricter POSIX
/// `f_bavail`-equivalent figure. Using the same key is what gets this app's
/// numbers close to what System Settings shows; raw `statfs` alone (what the
/// `sysinfo` crate exposes) does not, and undercounts "available" by however
/// much purgeable space currently exists.
///
/// This mirrors: `[NSURL resourceValuesForKeys:@[NSURLVolumeTotalCapacityKey,
/// NSURLVolumeAvailableCapacityKey, NSURLVolumeAvailableCapacityForImportantUsageKey] error:nil]`
/// on `/System/Volumes/Data` (the volume macOS actually stores user data on;
/// `/` is the separate, mostly-fixed-size, read-only system volume).
#[cfg(target_os = "macos")]
mod mac_volume {
    use objc2::rc::Retained;
    use objc2_foundation::{NSArray, NSNumber, NSString, NSURL, NSURLResourceKey};

    #[allow(non_upper_case_globals)]
    extern "C" {
        static NSURLVolumeTotalCapacityKey: &'static NSURLResourceKey;
        static NSURLVolumeAvailableCapacityKey: &'static NSURLResourceKey;
        static NSURLVolumeAvailableCapacityForImportantUsageKey: &'static NSURLResourceKey;
    }

    /// (total_bytes, available_for_important_usage_bytes, raw_available_bytes)
    pub fn volume_capacity(path: &str) -> Option<(u64, u64, u64)> {
        // SAFETY: these are plain read-only Foundation calls (no mutation of
        // app state); `path` is a valid UTF-8 filesystem path we constructed
        // ourselves from `dirs::home_dir()` / a fixed literal.
        unsafe {
            let ns_path = NSString::from_str(path);
            let url: Retained<NSURL> = NSURL::fileURLWithPath(&ns_path);

            let keys = NSArray::from_slice(&[
                NSURLVolumeTotalCapacityKey,
                NSURLVolumeAvailableCapacityKey,
                NSURLVolumeAvailableCapacityForImportantUsageKey,
            ]);

            let dict = url.resourceValuesForKeys_error(&keys).ok()?;

            let read = |key: &NSURLResourceKey| -> Option<u64> {
                let obj = dict.objectForKey(key)?;
                let num: &NSNumber = obj.downcast_ref()?;
                Some(num.as_i64().max(0) as u64)
            };

            let total = read(NSURLVolumeTotalCapacityKey)?;
            let available_important = read(NSURLVolumeAvailableCapacityForImportantUsageKey)?;
            let available_raw = read(NSURLVolumeAvailableCapacityKey)?;
            Some((total, available_important, available_raw))
        }
    }
}

pub fn get_system_overview() -> SystemOverviewDto {
    let disks = Disks::new_with_refreshed_list();

    let primary = disks
        .iter()
        .find(|d| d.mount_point().to_str() == Some("/"))
        .or_else(|| disks.iter().max_by_key(|d| d.total_space()));

    let (mut total_bytes, mut available_bytes, volume_name) = match primary {
        Some(d) => {
            let name = d.name().to_string_lossy().to_string();
            (
                d.total_space(),
                d.available_space(),
                if name.trim().is_empty() {
                    "Macintosh HD".to_string()
                } else {
                    name
                },
            )
        }
        None => (0, 0, "Unknown Volume".to_string()),
    };

    let mut purgeable_bytes = 0u64;

    #[cfg(target_os = "macos")]
    {
        // The Data volume is where macOS actually reports user-facing
        // storage from (Storage settings, About This Mac) — "/" is the
        // separate, largely fixed-size system volume on modern macOS.
        if let Some((total, available_important, available_raw)) =
            mac_volume::volume_capacity("/System/Volumes/Data")
        {
            total_bytes = total;
            available_bytes = available_important;
            purgeable_bytes = available_important.saturating_sub(available_raw);
        }
    }

    let used_bytes = total_bytes.saturating_sub(available_bytes);

    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let username = whoami::username();

    SystemOverviewDto {
        total_bytes,
        used_bytes,
        free_bytes: available_bytes,
        purgeable_bytes,
        volume_name,
        home_dir,
        username,
    }
}
