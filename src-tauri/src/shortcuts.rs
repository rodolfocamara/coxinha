//! Global shortcuts. Registered at startup, live for the app's lifetime,
//! and rebindable from Settings (spec 0128 P6).
//!
//! Each shortcut reveals the window and navigates to a specific route.
//!
//! The registry remembers, per action, the chord in force, why registration
//! failed and when a press last arrived. "Registered" only means the plugin
//! accepted the chord: on Wayland the compositor can still keep the key, so
//! the last press received is the only proof a chord reaches the app.

use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use shared::ShortcutsConfig;
use specta::Type;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_specta::Event;

use crate::events::{Navigate, Route};
use crate::window::show_main;
use conflicts::{chord_owner, desktop_chords};
use registry::{rebind, ChordBackend, Registry};

mod conflicts;
mod registry;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutAction {
    NewNote,
    OpenApp,
    Agenda,
    Meetings,
    ToggleRecording,
}

const ACTIONS: [ShortcutAction; 5] = [
    ShortcutAction::NewNote,
    ShortcutAction::OpenApp,
    ShortcutAction::Agenda,
    ShortcutAction::Meetings,
    ShortcutAction::ToggleRecording,
];

impl ShortcutAction {
    pub(crate) fn route(self) -> Route {
        match self {
            Self::NewNote => Route::NotesNew,
            Self::OpenApp => Route::Home,
            Self::Agenda => Route::Agenda,
            Self::Meetings => Route::Meetings,
            Self::ToggleRecording => Route::ToggleRecording,
        }
    }

    pub(crate) fn chord(self, cfg: &ShortcutsConfig) -> &str {
        match self {
            Self::NewNote => &cfg.new_note,
            Self::OpenApp => &cfg.open_app,
            Self::Agenda => &cfg.agenda,
            Self::Meetings => &cfg.meetings,
            Self::ToggleRecording => &cfg.toggle_recording,
        }
    }

    pub(crate) fn set_chord(self, cfg: &mut ShortcutsConfig, chord: String) {
        match self {
            Self::NewNote => cfg.new_note = chord,
            Self::OpenApp => cfg.open_app = chord,
            Self::Agenda => cfg.agenda = chord,
            Self::Meetings => cfg.meetings = chord,
            Self::ToggleRecording => cfg.toggle_recording = chord,
        }
    }
}

/// `Taken` means the OS said another registration holds the chord.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutFailure {
    Invalid,
    Taken,
    Duplicate,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub action: ShortcutAction,
    pub chord: String,
    pub registered: bool,
    pub failure: Option<ShortcutFailure>,
    pub detail: Option<String>,
    /// The desktop gives this chord to another app, where that can be read.
    pub conflict: Option<String>,
    pub last_fired_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutReport {
    pub statuses: Vec<ShortcutStatus>,
    pub wayland: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutChange {
    pub ok: bool,
    pub failure: Option<ShortcutFailure>,
    pub detail: Option<String>,
    pub report: ShortcutReport,
}

struct PluginBackend<'a>(&'a AppHandle);

impl ChordBackend for PluginBackend<'_> {
    fn register(&self, shortcut: Shortcut) -> std::result::Result<(), String> {
        self.0
            .global_shortcut()
            .register(shortcut)
            .map_err(|e| e.to_string())
    }
    fn unregister(&self, shortcut: Shortcut) -> std::result::Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|e| e.to_string())
    }
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

fn wayland_session() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").is_ok_and(|session| session == "wayland")
            || std::env::var_os("WAYLAND_DISPLAY").is_some())
}

fn current_report(cfg: &ShortcutsConfig) -> ShortcutReport {
    let chords = desktop_chords();
    registry()
        .lock()
        .unwrap()
        .report(cfg, &|chord| chord_owner(chord, &chords), wayland_session())
}

pub fn register_all(app: &AppHandle, cfg: &ShortcutsConfig) -> Result<()> {
    let (ok, fail) = registry()
        .lock()
        .unwrap()
        .register_config(&PluginBackend(app), cfg);
    // One-line summary — shortcut_smoke asserts on this exact shape
    // ("shortcut registration summary: N ok, M failed") so keep the
    // format stable.
    tracing::info!("shortcut registration summary: {} ok, {} failed", ok, fail);
    Ok(())
}

pub fn handle_shortcut(
    app: &AppHandle,
    shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state() != ShortcutState::Pressed {
        return;
    }

    let route = {
        let mut registry = registry().lock().unwrap();
        let action = registry.routes.get(shortcut).copied();
        if let Some(action) = action {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as f64)
                .unwrap_or_default();
            registry.fired.insert(action, now);
        }
        action.map(ShortcutAction::route).unwrap_or(Route::Home)
    };
    tracing::info!("shortcut {} -> {:?}", shortcut, route);

    show_main(app);
    let _ = Navigate { route }.emit(app);
}

/// Serializes rebinds; a press only needs the registry.
static REBINDING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
#[specta::specta]
pub async fn shortcut_status(
    state: tauri::State<'_, std::sync::Arc<tokio::sync::Mutex<crate::config::AppState>>>,
) -> std::result::Result<ShortcutReport, String> {
    let cfg = state.lock().await.config.shortcuts.clone();
    Ok(current_report(&cfg))
}

#[tauri::command]
#[specta::specta]
pub async fn set_shortcut(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<tokio::sync::Mutex<crate::config::AppState>>>,
    action: ShortcutAction,
    chord: String,
) -> std::result::Result<ShortcutChange, String> {
    let _rebinding = REBINDING.lock().await;
    let chord = chord.trim().to_string();
    let before = state.lock().await.config.shortcuts.clone();
    let backend = PluginBackend(&app);
    if let Err((failure, detail)) = rebind(registry(), &backend, &before, action, &chord) {
        tracing::warn!("rebinding {:?} to {} failed: {}", action, chord, detail);
        return Ok(ShortcutChange {
            ok: false,
            failure: Some(failure),
            detail: Some(detail),
            report: current_report(&before),
        });
    }
    let saved = {
        let mut state = state.lock().await;
        let mut config = state.config.clone();
        action.set_chord(&mut config.shortcuts, chord);
        state.update_config(config).await
    };
    if let Err(error) = saved {
        // Keeps the config and the live chord equal: the next start reads the config.
        let _ = rebind(registry(), &backend, &before, action, action.chord(&before));
        return Ok(ShortcutChange {
            ok: false,
            failure: Some(ShortcutFailure::Failed),
            detail: Some(error.to_string()),
            report: current_report(&before),
        });
    }
    let cfg = state.lock().await.config.shortcuts.clone();
    Ok(ShortcutChange {
        ok: true,
        failure: None,
        detail: None,
        report: current_report(&cfg),
    })
}
