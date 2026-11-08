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

/// Spec 0132 P3: before the first show, shrink the main window into the monitor's
/// work area (the screen minus the taskbar) and centre it there.
pub fn fit_main_to_work_area(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(Some(monitor)), Ok(size)) = (w.current_monitor(), w.outer_size()) else {
        return;
    };
    let area = monitor.work_area();
    let Some((x, y, width, height)) = fit(
        (size.width, size.height),
        (
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        ),
    ) else {
        return;
    };
    let _ = w.set_size(tauri::PhysicalSize::new(width, height));
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

/// `None` when the window already fits; otherwise its centred bounds inside `area`.
fn fit(window: (u32, u32), area: (i32, i32, u32, u32)) -> Option<(i32, i32, u32, u32)> {
    let (ax, ay, aw, ah) = area;
    if aw == 0 || ah == 0 || (window.0 <= aw && window.1 <= ah) {
        return None;
    }
    let (w, h) = (window.0.min(aw), window.1.min(ah));
    let centre = |start: i32, outer: u32, inner: u32| start + ((outer - inner) / 2) as i32;
    Some((centre(ax, aw, w), centre(ay, ah, h), w, h))
}

#[cfg(test)]
mod tests {
    use super::fit;

    #[test]
    fn a_window_taller_than_the_work_area_shrinks_and_centres() {
        // 1280x800 screen with a 48 px taskbar at the bottom.
        assert_eq!(
            fit((1200, 800), (0, 0, 1280, 752)),
            Some((40, 0, 1200, 752))
        );
        // Taskbar on top: the area starts below it.
        assert_eq!(
            fit((1200, 800), (0, 48, 1280, 752)),
            Some((40, 48, 1200, 752))
        );
    }

    #[test]
    fn a_window_that_fits_or_an_unknown_area_is_left_alone() {
        assert_eq!(fit((1200, 800), (0, 0, 1920, 1040)), None);
        assert_eq!(fit((1200, 800), (0, 0, 0, 0)), None);
    }
}
