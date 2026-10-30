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
