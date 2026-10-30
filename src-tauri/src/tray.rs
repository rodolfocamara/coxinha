//! System tray icon + menu.

use anyhow::Result;
use rust_i18n::t;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};
use tauri_specta::Event;

use crate::events::{Navigate, Route};
use crate::window::show_main;

pub fn setup(app: &AppHandle) -> Result<()> {
    let open_item = MenuItem::with_id(app, "open", t!("tray.open"), true, None::<&str>)?;
    let new_note_item = MenuItem::with_id(app, "new-note", t!("tray.newNote"), true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let settings_item =
        MenuItem::with_id(app, "settings", t!("tray.settings"), true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", t!("tray.quit"), true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&open_item, &new_note_item, &sep, &settings_item, &quit_item],
    )?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "new-note" => {
                show_main(app);
                let _ = Navigate {
                    route: Route::NotesNew,
                }
                .emit(app);
            }
            "settings" => {
                show_main(app);
                let _ = Navigate {
                    route: Route::Settings,
                }
                .emit(app);
            }
            "quit" => crate::desktop::request_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
