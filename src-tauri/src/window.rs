//! Window helpers shared across tray, shortcuts, and commands.

use tauri::{AppHandle, Manager};

/// Reveal and focus the main window. Safe to call when it's already visible.
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Flags the taskbar entry; Wayland compositors refuse `set_focus` from the background.
pub fn request_attention(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.request_user_attention(Some(tauri::UserAttentionType::Critical));
    }
}
