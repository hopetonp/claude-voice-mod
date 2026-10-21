#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use voicemesh_desktop::{configure_settings_window, SettingsState};

#[cfg(target_os = "macos")]
fn round_native_mac_window(window: &WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    let Ok(ns_window) = window.ns_window() else { return };
    unsafe {
        let ns_window = ns_window.cast::<AnyObject>();
        let content: *mut AnyObject = msg_send![ns_window, contentView];
        if !content.is_null() {
            let _: () = msg_send![content, setWantsLayer: true];
            let layer: *mut AnyObject = msg_send![content, layer];
            if !layer.is_null() {
                let _: () = msg_send![layer, setCornerRadius: 13.0f64];
                let _: () = msg_send![layer, setMasksToBounds: true];
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn claude_window_center() -> Option<(f64, f64)> {
    use core_foundation::{
        base::{CFType, TCFType},
        dictionary::CFDictionary,
        number::CFNumber,
        string::CFString,
    };
    use core_graphics::window::{
        create_description_from_array, create_window_list, kCGNullWindowID, kCGWindowBounds,
        kCGWindowLayer, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        kCGWindowOwnerPID,
    };
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::ns_string;

    let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(
        ns_string!("com.anthropic.claudefordesktop"),
    );
    let pids: Vec<i32> = apps.iter().map(|app| app.processIdentifier()).collect();
    if pids.is_empty() {
        return None;
    }
    let ids = create_window_list(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )?;
    let windows = create_description_from_array(ids)?;
    for info in windows.iter() {
        let pid_key = unsafe { CFString::wrap_under_get_rule(kCGWindowOwnerPID) };
        let layer_key = unsafe { CFString::wrap_under_get_rule(kCGWindowLayer) };
        let bounds_key = unsafe { CFString::wrap_under_get_rule(kCGWindowBounds) };
        let Some(pid) = info
            .find(&pid_key)
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|value| value.to_i32())
        else {
            continue;
        };
        let Some(layer) = info
            .find(&layer_key)
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|value| value.to_i32())
        else {
            continue;
        };
        if !pids.contains(&pid) || layer != 0 {
            continue;
        }
        let Some(bounds) = info
            .find(&bounds_key)
            .and_then(|value| value.downcast::<CFDictionary>())
        else {
            continue;
        };
        let bounds: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(bounds.as_concrete_TypeRef()) };
        let value = |key: &str| -> Option<f64> {
            bounds.find(&CFString::new(key))?.downcast::<CFNumber>()?.to_f64()
        };
        let (Some(x), Some(y), Some(width), Some(height)) =
            (value("X"), value("Y"), value("Width"), value("Height"))
        else {
            continue;
        };
        if width >= 300.0 && height >= 200.0 {
            return Some((x + width / 2.0, y + height / 2.0));
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn place_over_claude(window: &WebviewWindow) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWindow};

    let Some((x, y)) = claude_window_center() else {
        return false;
    };
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let screens = NSScreen::screens(mtm);
    let Some(primary) = screens.iter().find(|screen| {
        let frame = screen.frame();
        frame.origin.x == 0.0 && frame.origin.y == 0.0
    }) else {
        return false;
    };
    // Core Graphics uses a top-left origin; AppKit uses a bottom-left origin.
    let cocoa_y = primary.frame().size.height - y;
    let Some(screen) = screens.iter().find(|screen| {
        let frame = screen.frame();
        x >= frame.origin.x && x < frame.origin.x + frame.size.width
            && cocoa_y >= frame.origin.y && cocoa_y < frame.origin.y + frame.size.height
    }) else {
        return false;
    };
    let Ok(native) = window.ns_window() else {
        return false;
    };
    let native = unsafe { &*native.cast::<NSWindow>() };
    let frame = native.frame();
    let visible = screen.visibleFrame();
    let max_left = (visible.origin.x + visible.size.width - frame.size.width).max(visible.origin.x);
    let max_bottom = (visible.origin.y + visible.size.height - frame.size.height).max(visible.origin.y);
    let left = (x - frame.size.width / 2.0).clamp(visible.origin.x, max_left);
    let bottom = (cocoa_y - frame.size.height / 2.0).clamp(visible.origin.y, max_bottom);
    native.setFrameOrigin(objc2_foundation::NSPoint::new(left, bottom));
    true
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    #[ignore = "requires Claude Desktop to be running with a visible window"]
    fn finds_claude_window_without_screen_recording() {
        assert!(super::claude_window_center().is_some());
    }
}

// Fallback when Claude has no visible window, and for non-macOS hosts.
fn place_over_invoking_screen(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    if place_over_claude(window) {
        return;
    }
    let app = window.app_handle();
    let Ok(cursor) = app.cursor_position() else { return };
    let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) else { return };
    let Ok(size) = window.outer_size() else { return };
    let origin = monitor.position();
    let bounds = monitor.size();
    let width = size.width.min(bounds.width) as i32;
    let height = size.height.min(bounds.height) as i32;
    let left = origin.x;
    let top = origin.y;
    let right = left + bounds.width as i32 - width;
    let bottom = top + bounds.height as i32 - height;
    let x = left + (right - left) / 2;
    let y = top + (bottom - top) / 2;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn parse_settings_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|error| error.to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "http"
        || !local
        || url.port().is_none()
        || url.path() != "/setup/"
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Settings must use the local VoiceMesh setup page".to_string());
    }
    Ok(url)
}

fn settings_url() -> Result<tauri::Url, String> {
    let value = std::env::args()
        .nth(1)
        .ok_or_else(|| "Pass the local VoiceMesh settings URL".to_string())?;
    parse_settings_url(&value)
}

fn main() {
    let url = settings_url().unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(2);
    });

    configure_settings_window(tauri::Builder::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if let Some(window) = app.get_webview_window("settings") {
                if let Some(url) = args.get(1).and_then(|value| parse_settings_url(value).ok()) {
                    if window.url().ok().as_ref() != Some(&url) {
                        app.state::<SettingsState>().prepare_reload();
                        let _ = window.hide();
                        let _ = window.navigate(url);
                    }
                }
                place_over_invoking_screen(&window);
                let _ = window.set_always_on_top(true);
                if app.state::<SettingsState>().is_ready() {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        }))
        .setup(move |app| {
            let builder = WebviewWindowBuilder::new(app, "settings", WebviewUrl::External(url.clone()))
                .title("Voice settings")
                .inner_size(760.0, 580.0)
                .resizable(false)
                .minimizable(false)
                .maximizable(false)
                .always_on_top(true)
                // Position the hidden window first; React reveals it when the shell is mounted.
                .visible(false)
                .focused(false);
            #[cfg(target_os = "macos")]
            let builder = builder
                .decorations(false)
                .transparent(true);
            #[cfg(target_os = "windows")]
            let builder = builder.decorations(false);
            let window = builder.build()?;
            #[cfg(target_os = "macos")]
            round_native_mac_window(&window);
            place_over_invoking_screen(&window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Could not run VoiceMesh settings window");
}
