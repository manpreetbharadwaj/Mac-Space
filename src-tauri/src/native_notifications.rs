//! Real macOS notifications sent and received directly through
//! `UNUserNotificationCenter` (via `objc2`/`objc2-user-notifications`),
//! bypassing `tauri-plugin-notification` for this specific need.
//!
//! Why not the plugin: read directly (not assumed) from
//! `tauri-plugin-notification` 2.4.0's `desktop.rs` — its `show()` posts
//! through the legacy `notify-rust` / `NSUserNotificationCenter` stack, which
//! has no click/action callback wired up at all in that plugin, and even the
//! underlying `notify-rust` crate's legacy path (`NotificationHandle::
//! wait_for_action`) only delivers a click to whichever process is *still
//! alive* and pumping the run loop when the user clicks — it cannot relaunch
//! a quit app. `UNUserNotificationCenter` is the modern framework built
//! specifically to support "app quit -> notification clicked -> app
//! launched -> delegate told which notification" and is what iOS/macOS apps
//! use for exactly this. This module is deliberately narrow: it only sends
//! notifications and reports clicks (route handoff below) — it changes
//! nothing about notification permission *reporting* in the UI (still the
//! plugin's, with its documented "always granted" caveat — see
//! docs/scheduled-scans.md) since that wasn't required to make clicks work.
//!
//! Known constraint (expected, not a bug): `UNUserNotificationCenter`
//! requires the calling process to belong to a real, on-disk `.app` bundle
//! with a valid bundle identifier. This works from both the normal GUI
//! process AND the headless `--background-scan` invocation *in a packaged
//! build* (both are the same on-disk `Contents/MacOS/app`, which is what
//! determines bundle identity — not whether a window exists), but does not
//! work from a bare `cargo run` / `target/debug/app` dev binary, which has no
//! real bundle — calling `UNUserNotificationCenter::currentNotificationCenter()`
//! there doesn't return an error, it throws an uncaught Objective-C
//! exception that aborts the whole process (confirmed by hitting it live,
//! not assumed). `has_real_app_bundle()` (backed by `tauri::is_dev()`, a
//! compile-time check) guards every entry point below so `tauri dev` no-ops
//! instead of crashing; the native click path is only real in a packaged
//! build.

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_core_foundation::CFRunLoop;
use objc2_foundation::{NSDictionary, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

/// Routes a notification click may navigate to. Anything else (unknown,
/// malformed, or absent) falls back to `FALLBACK_ROUTE` — see
/// `validate_route`. Keep in sync with the routes declared in `src/App.tsx`.
const ALLOWED_ROUTES: &[&str] = &["/dashboard", "/cleanup", "/scan", "/schedule", "/settings", "/history"];
const FALLBACK_ROUTE: &str = "/dashboard";
const USER_INFO_ROUTE_KEY: &str = "route";
/// Event name the frontend listens for when a click arrives while the app's
/// frontend is already mounted and running — see useNotificationRouteHandoff.
const ROUTE_EVENT: &str = "notification-route";

/// Never trust a route string from a notification payload as-is (it's OS
/// carried, cross-process, data) — only ever navigate to one of a fixed
/// allowlist matching the app's own real routes.
pub fn validate_route(route: &str) -> &'static str {
    ALLOWED_ROUTES.iter().find(|&&r| r == route).copied().unwrap_or(FALLBACK_ROUTE)
}

/// Set by the delegate when a click arrives and the frontend either isn't
/// mounted yet (cold launch) or might have missed the live event for some
/// other reason. Consumed exactly once via `take_pending_route` — see
/// `get_pending_notification_route` in commands.rs and the matching
/// frontend hook, which implements: native click -> store pending route ->
/// frontend starts -> frontend asks for pending route -> navigate -> clear.
static PENDING_ROUTE: Mutex<Option<String>> = Mutex::new(None);

pub fn take_pending_route() -> Option<String> {
    PENDING_ROUTE.lock().unwrap().take()
}

fn set_pending_route(route: &str) {
    *PENDING_ROUTE.lock().unwrap() = Some(route.to_string());
}

/// Best-effort authorization request — required at least once for
/// `UNUserNotificationCenter` to ever actually display anything; failures
/// are logged, never surfaced as an error to the caller. Does not change
/// what the Settings/Schedule UI shows (that's still backed by
/// tauri-plugin-notification's own, separately-documented permission
/// reporting) — this is purely internal plumbing needed for the native
/// click path to function at all.
/// `UNUserNotificationCenter::currentNotificationCenter()` throws an
/// uncaught `NSInternalInconsistencyException` ("bundleProxyForCurrentProcess
/// is nil") — not a Rust-catchable error — when the calling process has no
/// real on-disk `.app` bundle, i.e. a bare `cargo run` / `target/debug/app`
/// dev binary (confirmed by actually crashing `npm run tauri:dev` with this
/// exact exception, not assumed). `tauri::is_dev()` is a compile-time check
/// (`custom-protocol` feature, set by `tauri build`/unset by `tauri dev`)
/// that exactly tracks whether this compiled binary lives in a real bundle,
/// for both the GUI and `--background-scan` invocations of it alike — so
/// every entry point below checks it first and no-ops instead of crashing.
fn has_real_app_bundle() -> bool {
    !tauri::is_dev()
}

pub fn request_authorization() {
    if !has_real_app_bundle() {
        log::info!("[native-notifications] skipping authorization request — no real .app bundle (dev build)");
        return;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let handler = block2::RcBlock::new(|granted: Bool, error: *mut NSError| {
        if !granted.as_bool() {
            log::info!("[native-notifications] UNUserNotificationCenter authorization not granted");
        }
        if !error.is_null() {
            log::info!("[native-notifications] authorization request reported an error (non-fatal)");
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &handler,
    );
}

/// Diagnostic only (invoked via `--check-notification-permission`, see
/// lib.rs) — prints the real, current `UNAuthorizationStatus` for this exact
/// bundle. Read-only: never requests, changes, or acts on anything. Exists
/// specifically to answer "is this actually authorized?" with a first-party,
/// unambiguous source instead of guessing from log inference or unreadable
/// system databases (`~/Library/Application Support/com.apple.TCC/TCC.db`
/// requires Full Disk Access even to open; `com.apple.ncprefs.plist` may not
/// contain an entry yet even when a status genuinely exists).
pub fn print_authorization_status() {
    if !has_real_app_bundle() {
        println!("[notification-permission] no real .app bundle (dev build) — UNUserNotificationCenter is unusable here, status is meaningless");
        return;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let status = std::sync::Arc::new(std::sync::atomic::AtomicI64::new(-1));
    let status_writer = status.clone();
    let handler = block2::RcBlock::new(move |settings: std::ptr::NonNull<objc2_user_notifications::UNNotificationSettings>| {
        let settings = unsafe { settings.as_ref() };
        status_writer.store(settings.authorizationStatus().0 as i64, std::sync::atomic::Ordering::SeqCst);
    });
    center.getNotificationSettingsWithCompletionHandler(&handler);

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(3000);
    while std::time::Instant::now() < deadline && status.load(std::sync::atomic::Ordering::SeqCst) == -1 {
        let mode = unsafe { objc2_core_foundation::kCFRunLoopDefaultMode };
        CFRunLoop::run_in_mode(mode, 0.05, false);
    }

    let raw = status.load(std::sync::atomic::Ordering::SeqCst);
    let label = match raw {
        0 => "notDetermined (never asked / user hasn't responded)",
        1 => "denied",
        2 => "authorized",
        3 => "provisional",
        4 => "ephemeral",
        -1 => "TIMED OUT waiting for a response — completion handler never fired within 3s",
        _ => "unknown",
    };
    println!("[notification-permission] UNAuthorizationStatus = {raw} ({label})");
    if raw == -1 {
        std::process::exit(1);
    }
}

/// Posts a real notification carrying `route` in its `userInfo`, so a click
/// on it — whether the app is running or has to be launched fresh — can be
/// resolved back to a validated in-app route. Fire-and-forget: like the
/// plugin path it replaces, submission to the system is asynchronous, so a
/// short wait follows to give it a chance to actually reach the daemon
/// before a short-lived caller (the headless background job) exits.
/// Returns whether the submission completed without the system reporting an
/// error — the same honesty level `scanEvents.notificationSent` had under
/// the previous plugin-based implementation (a local API success signal,
/// not visual proof a banner was seen).
pub fn send(title: &str, body: &str, route: &str) -> bool {
    if !has_real_app_bundle() {
        log::info!("[native-notifications] skipping send — no real .app bundle (dev build)");
        return false;
    }
    let route = validate_route(route);
    let content = UNMutableNotificationContent::new();
    unsafe {
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));

        let key = NSString::from_str(USER_INFO_ROUTE_KEY);
        let value = NSString::from_str(route);
        let typed_info = NSDictionary::from_slices(&[&*key], &[&*value]);
        // SAFETY: `NSDictionary<NSString, NSString>` and the untyped
        // `NSDictionary` (`<AnyObject, AnyObject>`) `setUserInfo` expects are
        // the same runtime class — Objective-C generics are compile-time
        // only (erased at runtime), so this cast changes no actual layout or
        // behavior, only which Rust type is used to talk about it.
        let untyped_info: Retained<NSDictionary> = Retained::cast_unchecked(typed_info);
        content.setUserInfo(&untyped_info);
    }

    let identifier = NSString::from_str(&format!("com.macstoragemanager.app.notification.{}", now_millis()));
    // `trigger: None` means deliver immediately, matching the previous
    // plugin-based behavior (no scheduling/delay).
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None);

    let succeeded = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let fired = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let succeeded_writer = succeeded.clone();
    let fired_writer = fired.clone();
    let completion = block2::RcBlock::new(move |error: *mut NSError| {
        fired_writer.store(true, std::sync::atomic::Ordering::SeqCst);
        if error.is_null() {
            log::info!("[native-notifications] notification submitted");
            eprintln!("[native-notifications] addNotificationRequest completion fired: no error");
            succeeded_writer.store(true, std::sync::atomic::Ordering::SeqCst);
        } else {
            // SAFETY: non-null per the check above; the completion handler
            // contract guarantees this pointer is a valid NSError while the
            // block runs.
            let description = unsafe { (*error).localizedDescription() };
            log::warn!("[native-notifications] notification submission reported an error: {description}");
            eprintln!("[native-notifications] addNotificationRequest completion fired: error = {description}");
        }
    });
    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.addNotificationRequest_withCompletionHandler(&request, Some(&completion));

    // Submission is asynchronous (XPC to the system notification daemon), so
    // a short-lived headless caller needs to wait for the completion handler
    // before it can honestly report success. A flat `thread::sleep` here
    // was a real, confirmed bug (not a hunch): completion handlers for
    // Foundation/XPC-backed APIs like this one are delivered by *running the
    // current thread's run loop*, not merely by the passage of time — a
    // parked/sleeping thread never processes them at all. A headless process
    // has no `NSApplication`/`CFRunLoopRun()` ever started, so without this,
    // `succeeded` would (almost) always read back `false` regardless of
    // whether the notification was actually, successfully delivered.
    // Confirmed empirically: a real packaged-build run with a flat sleep
    // reported `notificationSent: false` even though the underlying
    // submission had no error; switching to pumping the run loop here is
    // what actually lets the completion block run.
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(3000);
    while std::time::Instant::now() < deadline {
        if succeeded.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        let mode = unsafe { objc2_core_foundation::kCFRunLoopDefaultMode };
        CFRunLoop::run_in_mode(mode, 0.05, false);
    }

    if !fired.load(std::sync::atomic::Ordering::SeqCst) {
        eprintln!("[native-notifications] addNotificationRequest completion NEVER fired within 3s");
    }

    succeeded.load(std::sync::atomic::Ordering::SeqCst)
}

/// Diagnostic only (invoked via `--send-test-notification`) — calls the
/// exact same `send()` used by real scheduled runs and prints the result,
/// so notification delivery can be checked directly without waiting for a
/// real auto-clean/threshold condition to occur.
pub fn send_test_notification() {
    let ok = send("Mac Storage Manager", "Diagnostic test notification.", "/dashboard");
    println!("[send-test-notification] send() returned: {ok}");
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_route_from_user_info(user_info: &NSDictionary) -> Option<String> {
    let key = NSString::from_str(USER_INFO_ROUTE_KEY);
    // SAFETY: reinterpreting the lookup key as `&AnyObject` is valid — the
    // ObjC method takes `id` (any object) as its key type; `NSDictionary`'s
    // Rust generics here are erased at runtime just like in `send` above.
    let key_any: &AnyObject = unsafe { &*(&*key as *const NSString as *const AnyObject) };
    let value = user_info.objectForKey(key_any)?;
    let value: &NSString = value.downcast_ref()?;
    Some(value.to_string())
}

struct DelegateIvars {
    app: AppHandle,
}

define_class!(
    // SAFETY:
    // - NSObject has no subclassing requirements.
    // - NotificationDelegate does not implement Drop.
    // - Not MainThreadOnly: UNUserNotificationCenter delivers delegate
    //   callbacks on an arbitrary internal queue, not necessarily the main
    //   thread (verified from Apple's own documentation for this protocol,
    //   unlike e.g. NSApplicationDelegate) — any work here that touches
    //   AppKit/window APIs is explicitly hopped to the main thread via
    //   `AppHandle::run_on_main_thread` rather than assumed to already be on
    //   it.
    #[unsafe(super(NSObject))]
    #[ivars = DelegateIvars]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        // Without this, UNUserNotificationCenter suppresses the banner/sound
        // entirely while this app is the foreground (frontmost) app —
        // opting in keeps behavior consistent with the previous
        // tauri-plugin-notification path, which always showed banners
        // regardless of foreground state.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &objc2_user_notifications::UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive_response(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let content = response.notification().request().content();
            let user_info = content.userInfo();
            let route = read_route_from_user_info(&user_info)
                .map(|r| validate_route(&r).to_string())
                .unwrap_or_else(|| FALLBACK_ROUTE.to_string());

            log::info!("[native-notifications] click resolved to route {route}");
            set_pending_route(&route);

            let app = self.ivars().app.clone();
            // emit() itself is thread-safe, but window operations below
            // (show/unminimize/focus) are AppKit calls and must happen on
            // the main thread.
            let _ = app.emit(ROUTE_EVENT, route.clone());
            let app_for_focus = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = app_for_focus.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            completion_handler.call(());
        }
    }
);

impl NotificationDelegate {
    fn new(app: AppHandle) -> Retained<Self> {
        let this = Self::alloc().set_ivars(DelegateIvars { app });
        unsafe { msg_send![super(this), init] }
    }
}

static INSTALLED_DELEGATE: OnceLock<Retained<NotificationDelegate>> = OnceLock::new();

/// Registers this app as the `UNUserNotificationCenter` delegate. Must be
/// called once during normal (GUI) startup, before any click could
/// plausibly arrive — never called from the headless `--background-scan`
/// path, which only ever calls `send()`.
///
/// `setDelegate` is a *weak* property (per Apple's docs, confirmed in the
/// generated binding's doc comment) — the delegate instance is kept alive
/// here in a process-lifetime static specifically so it isn't deallocated
/// out from under that weak reference.
pub fn install_delegate(app: AppHandle) {
    if !has_real_app_bundle() {
        log::info!("[native-notifications] skipping delegate installation — no real .app bundle (dev build); notification clicks won't resolve to a route in `tauri dev`");
        return;
    }
    let delegate = NotificationDelegate::new(app);
    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    let _ = INSTALLED_DELEGATE.set(delegate);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_route_allows_only_known_routes() {
        for route in ALLOWED_ROUTES {
            assert_eq!(validate_route(route), *route);
        }
    }

    #[test]
    fn validate_route_falls_back_on_anything_else() {
        let malicious = [
            "",
            "/",
            "dashboard",
            "/dashboard/../../etc/passwd",
            "https://evil.example/phish",
            "javascript:alert(1)",
            "/settings?evil=1",
            "/Cleanup",
            "/cleanup/",
        ];
        for route in malicious {
            assert_eq!(validate_route(route), FALLBACK_ROUTE, "should have fallen back for {route:?}");
        }
    }

    #[test]
    fn pending_route_round_trips_and_clears_once() {
        set_pending_route(validate_route("/cleanup"));
        assert_eq!(take_pending_route().as_deref(), Some("/cleanup"));
        assert_eq!(take_pending_route(), None, "must be cleared after one take");
    }
}
