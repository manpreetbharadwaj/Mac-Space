//! Launch at login via `SMAppService.mainAppService` (ServiceManagement,
//! macOS 13+) — the supported API that shows the app under System Settings ›
//! General › Login Items, where the user can always turn it off again.
//!
//! The source of truth is macOS itself (`status`), never a stored
//! preference, so the toggle can't drift from what's really registered.
//! Unavailable (and reported as such, not faked) on macOS 11–12, and in a
//! bare dev binary, which isn't an app bundle macOS can register.

use objc2::runtime::AnyClass;
use objc2_service_management::{SMAppService, SMAppServiceStatus};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoginItemStatusDto {
    /// "enabled" | "disabled" | "requiresApproval" | "unavailable"
    pub state: String,
    /// Why it's unavailable, or the system's error text from a failed change.
    pub detail: Option<String>,
}

fn unavailable(detail: &str) -> LoginItemStatusDto {
    LoginItemStatusDto { state: "unavailable".into(), detail: Some(detail.into()) }
}

fn supported() -> Result<(), LoginItemStatusDto> {
    if AnyClass::get(c"SMAppService").is_none() {
        return Err(unavailable("requiresMacOS13"));
    }
    if crate::diagnostics::current_install_location() == crate::diagnostics::InstallLocation::NotABundle {
        return Err(unavailable("devBuild"));
    }
    Ok(())
}

pub fn status() -> LoginItemStatusDto {
    if let Err(e) = supported() {
        return e;
    }
    // SAFETY: class availability checked above; plain status read.
    let status = unsafe { SMAppService::mainAppService().status() };
    let state = if status == SMAppServiceStatus::Enabled {
        "enabled"
    } else if status == SMAppServiceStatus::RequiresApproval {
        "requiresApproval"
    } else {
        "disabled"
    };
    LoginItemStatusDto { state: state.into(), detail: None }
}

pub fn set_enabled(enabled: bool) -> LoginItemStatusDto {
    if let Err(e) = supported() {
        return e;
    }
    // SAFETY: class availability checked above.
    let service = unsafe { SMAppService::mainAppService() };
    let result = unsafe { if enabled { service.registerAndReturnError() } else { service.unregisterAndReturnError() } };
    match result {
        Ok(()) => status(),
        Err(err) => {
            let mut s = status();
            s.detail = Some(err.localizedDescription().to_string());
            s
        }
    }
}

pub fn open_login_items_settings() {
    if AnyClass::get(c"SMAppService").is_some() {
        unsafe { SMAppService::openSystemSettingsLoginItems() };
    }
}
