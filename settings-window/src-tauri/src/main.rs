#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use voicemesh_desktop::{configure_settings_window, SettingsState};

#[cfg(target_os = "macos")]
fn hide_native_window_buttons(window: &WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    let Ok(ns_window) = window.ns_window() else { return };
    unsafe {
        let ns_window = ns_window.cast::<AnyObject>();
        for kind in 0usize..3 {
            let button: *mut AnyObject = msg_send![ns_window, standardWindowButton: kind];
            if !button.is_null() {
                let _: () = msg_send![button, setHidden: true];
            }
        }
    }
}

// The launch click identifies Claude's display. Center Settings on that
// display so moving the pointer does not move the window toward an edge.
fn place_over_invoking_screen(window: &WebviewWindow) {
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
                .transparent(false)
                .resizable(false)
                .minimizable(false)
                .maximizable(false)
                .always_on_top(true)
                // Position the hidden window first; React reveals it when the shell is mounted.
                .visible(false)
                .focused(false);
            #[cfg(target_os = "macos")]
            let builder = builder
                .decorations(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
            #[cfg(target_os = "windows")]
            let builder = builder.decorations(false);
            let window = builder.build()?;
            #[cfg(target_os = "macos")]
            hide_native_window_buttons(&window);
            place_over_invoking_screen(&window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Could not run VoiceMesh settings window");
}
