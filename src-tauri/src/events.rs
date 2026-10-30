//! Typed events emitted to the frontend. Each type derives
//! `tauri_specta::Event` so it emits under its snake_case name and
//! shows up in the generated TypeScript bindings.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;
use uuid::Uuid;

/// Routes the host can ask the frontend to navigate to. Kept as an
/// enum (not a string) so both sides share the same closed set — a
/// typo in tray/shortcut code becomes a compile error, not a silent
/// ignore in `App.tsx`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Route {
    /// Focus the main view and create a blank note.
    NotesNew,
    /// Show the main window as-is (last active view).
    Home,
    Agenda,
    Meetings,
    Settings,
    /// Toggle recording — handled by the recorder, not a view.
    ToggleRecording,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct Navigate {
    pub route: Route,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct CallDetected {
    pub app_name: String,
    pub process_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct RecordingProgress {
    pub meeting_id: Uuid,
    pub duration_seconds: u32,
    pub level_db: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TranscriptionProgress {
    pub meeting_id: Uuid,
    pub percent: f32,
    pub message: String,
}
