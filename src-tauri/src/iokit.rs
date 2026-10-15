//! Thin, read-only IOKit / IOPowerSources access for hardware facts that no
//! portable Rust crate exposes: battery registers, the platform expert
//! (model identifier, serial number), the device-tree product name, and GPU
//! accelerator info. Every function returns `None` when the registry entry or
//! key is absent — callers show "Unavailable", never a guessed value.
//!
//! Nothing here requires an entitlement or elevated privileges; these are the
//! same registry entries `ioreg` and System Information read as a normal user.

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::data::CFData;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef, CFMutableDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use std::ffi::{c_char, CString};

type IoObject = libc::mach_port_t;
type KernReturn = libc::kern_return_t;
/// `kIOMainPortDefault` / `kIOMasterPortDefault` are both defined as
/// `MACH_PORT_NULL`; passing 0 works on every macOS version this app
/// supports without depending on which of the two symbol names exists.
const MAIN_PORT_DEFAULT: libc::mach_port_t = 0;

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOServiceMatching(name: *const c_char) -> CFMutableDictionaryRef;
    fn IOServiceGetMatchingService(main_port: libc::mach_port_t, matching: CFDictionaryRef) -> IoObject;
    fn IOServiceGetMatchingServices(main_port: libc::mach_port_t, matching: CFDictionaryRef, existing: *mut IoObject) -> KernReturn;
    fn IOIteratorNext(iterator: IoObject) -> IoObject;
    fn IORegistryEntryFromPath(main_port: libc::mach_port_t, path: *const c_char) -> IoObject;
    fn IORegistryEntryCreateCFProperties(
        entry: IoObject,
        properties: *mut CFMutableDictionaryRef,
        allocator: CFTypeRef,
        options: u32,
    ) -> KernReturn;
    fn IOObjectRelease(object: IoObject) -> KernReturn;

    fn IOPSCopyPowerSourcesInfo() -> CFTypeRef;
    fn IOPSCopyPowerSourcesList(blob: CFTypeRef) -> CFArrayRef;
    fn IOPSGetPowerSourceDescription(blob: CFTypeRef, ps: CFTypeRef) -> CFDictionaryRef;
}

/// Owned registry properties of one IOKit object.
pub struct Props(CFDictionary<CFString, CFType>);

impl Props {
    fn get(&self, key: &str) -> Option<CFType> {
        self.0.find(CFString::new(key)).map(|v| v.clone())
    }

    pub fn i64(&self, key: &str) -> Option<i64> {
        self.get(key)?.downcast::<CFNumber>()?.to_i64()
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        Some(self.get(key)?.downcast::<CFBoolean>()?.into())
    }

    pub fn dictionary(&self, key: &str) -> Option<Props> {
        let value = self.get(key)?;
        let untyped = value.downcast::<CFDictionary>()?;
        // SAFETY: same object, re-wrapped (retained) with key/value types.
        Some(Props(unsafe { CFDictionary::wrap_under_get_rule(untyped.as_concrete_TypeRef()) }))
    }

    /// Strings in the registry are stored either as CFString or as a
    /// NUL-terminated CFData blob (device-tree properties) — accept both.
    pub fn string(&self, key: &str) -> Option<String> {
        let value = self.get(key)?;
        if let Some(s) = value.downcast::<CFString>() {
            let s = s.to_string();
            return (!s.trim().is_empty()).then(|| s.trim().to_string());
        }
        let data = value.downcast::<CFData>()?;
        let bytes: Vec<u8> = data.bytes().iter().copied().take_while(|b| *b != 0).collect();
        let s = String::from_utf8_lossy(&bytes).trim().to_string();
        (!s.is_empty()).then_some(s)
    }
}

fn properties_of(entry: IoObject) -> Option<Props> {
    if entry == 0 {
        return None;
    }
    let mut dict: CFMutableDictionaryRef = std::ptr::null_mut();
    let rc = unsafe { IORegistryEntryCreateCFProperties(entry, &mut dict, std::ptr::null(), 0) };
    unsafe { IOObjectRelease(entry) };
    if rc != libc::KERN_SUCCESS || dict.is_null() {
        return None;
    }
    // SAFETY: "Create" rule — we own the returned dictionary.
    Some(Props(unsafe { CFDictionary::wrap_under_create_rule(dict as CFDictionaryRef) }))
}

/// Properties of the first service matching an IOKit class name.
pub fn service_properties(class: &str) -> Option<Props> {
    let cname = CString::new(class).ok()?;
    // IOServiceGetMatchingService consumes the matching dictionary.
    let entry = unsafe { IOServiceGetMatchingService(MAIN_PORT_DEFAULT, IOServiceMatching(cname.as_ptr()) as CFDictionaryRef) };
    properties_of(entry)
}

/// Properties of every service matching an IOKit class name.
pub fn all_service_properties(class: &str) -> Vec<Props> {
    let Ok(cname) = CString::new(class) else { return Vec::new() };
    let mut iter: IoObject = 0;
    let rc = unsafe { IOServiceGetMatchingServices(MAIN_PORT_DEFAULT, IOServiceMatching(cname.as_ptr()) as CFDictionaryRef, &mut iter) };
    if rc != libc::KERN_SUCCESS || iter == 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    loop {
        let entry = unsafe { IOIteratorNext(iter) };
        if entry == 0 {
            break;
        }
        if let Some(p) = properties_of(entry) {
            out.push(p);
        }
    }
    unsafe { IOObjectRelease(iter) };
    out
}

pub fn registry_path_properties(path: &str) -> Option<Props> {
    let cpath = CString::new(path).ok()?;
    let entry = unsafe { IORegistryEntryFromPath(MAIN_PORT_DEFAULT, cpath.as_ptr()) };
    properties_of(entry)
}

/// The internal battery's IOPowerSources description (what the menu-bar
/// battery item reads): percentage, power source, health/condition, times.
/// `None` on Macs without an internal battery.
pub fn internal_battery_power_source() -> Option<Props> {
    unsafe {
        let blob = IOPSCopyPowerSourcesInfo();
        if blob.is_null() {
            return None;
        }
        let blob = CFType::wrap_under_create_rule(blob);
        let list = IOPSCopyPowerSourcesList(blob.as_CFTypeRef());
        if list.is_null() {
            return None;
        }
        let list: CFArray<CFType> = CFArray::wrap_under_create_rule(list);
        for ps in list.iter() {
            let desc = IOPSGetPowerSourceDescription(blob.as_CFTypeRef(), ps.as_CFTypeRef());
            if desc.is_null() {
                continue;
            }
            // "Get" rule — not owned; retain it so it outlives `blob`.
            let props = Props(CFDictionary::wrap_under_get_rule(desc));
            if props.string("Type").as_deref() == Some("InternalBattery") {
                return Some(props);
            }
        }
        None
    }
}

/// Power source state without needing a battery ("AC Power" / "Battery Power" / "UPS Power").
pub fn providing_power_source_type() -> Option<String> {
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPSGetProvidingPowerSourceType(snapshot: CFTypeRef) -> CFStringRef;
    }
    unsafe {
        let blob = IOPSCopyPowerSourcesInfo();
        if blob.is_null() {
            return None;
        }
        let blob = CFType::wrap_under_create_rule(blob);
        let s = IOPSGetProvidingPowerSourceType(blob.as_CFTypeRef());
        if s.is_null() {
            return None;
        }
        Some(CFString::wrap_under_get_rule(s).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_expert_is_readable() {
        let pe = service_properties("IOPlatformExpertDevice").expect("IOPlatformExpertDevice must exist on every Mac");
        assert!(pe.string("model").is_some(), "model identifier should be present");
    }

    #[test]
    fn missing_class_is_none_not_a_panic() {
        assert!(service_properties("ThisClassDoesNotExist123").is_none());
        assert!(all_service_properties("ThisClassDoesNotExist123").is_empty());
    }
}
