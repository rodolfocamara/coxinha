//! Spec 0124 P4: what each meeting already has, read from one place. The agenda
//! polls this and a future coach will read it, so it stays cheap: booleans and
//! counts, off the library actor, on read-only connections.
pub mod marks;
mod sources;

use crate::cli::data::{open_read_only, sessions as stored_sessions, Session};
use crate::cli::paths::Paths;
use crate::library::Library;
use crate::storage::Storage;
use chrono::{DateTime, Utc};
use marks::Mark;
use serde::Serialize;
use std::sync::Arc;

const MAX_SESSIONS: usize = 2000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct SpeakerCounts {
    pub named: u32,
    pub unnamed: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct FollowUps {
    /// Activities linked to the meeting by the owner.
    pub linked: u32,
    /// Bullets of the summary's actions section: suggestions, not tasks.
    pub actions: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSignals {
    pub session_id: String,
    pub transcript: bool,
    pub speakers: SpeakerCounts,
    pub note: bool,
    pub preparation: bool,
    pub diagram: bool,
    pub summary: bool,
    pub follow_ups: FollowUps,
    /// Summary, follow-ups, diagram or a note. Never means useful.
    pub generated_content: bool,
    pub mark: Option<Mark>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SignalsReport {
    /// The opt-in of spec 0108: without it no meeting reaches Memory.
    pub summaries_on: bool,
    pub sessions: Vec<MeetingSignals>,
}

fn instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Evidence only: a time we cannot read, or a session without a start, is no
/// preparation.
fn before(at: Option<DateTime<Utc>>, start: Option<DateTime<Utc>>) -> bool {
    matches!((at, start), (Some(at), Some(start)) if at < start)
}

/// Every session's signals, newest first, at most `MAX_SESSIONS`.
pub fn collect(paths: &Paths) -> Result<Vec<MeetingSignals>, String> {
    let db = open_read_only(&paths.meetings_db())?;
    let sessions = stored_sessions(&db)?;
    let runs = sources::runs(&db)?;
    let summaries = sources::summaries(&db);
    drop(db);
    let named = sources::named(paths);
    let folders = sources::folders(&paths.vault);
    let linked = sources::linked(&paths.vault);
    let board = sources::on_board(&paths.vault);
    let marks = marks::load(&paths.data).marks;
    let signals_of = |session: &Session| {
        let start = session.starts_at.as_deref().and_then(instant);
        let run = session.meeting_id.as_ref().and_then(|m| runs.get(m));
        let speakers = run.map_or_else(SpeakerCounts::default, |(job, run)| {
            let total = run.speakers.len() as u32;
            let known = run
                .speakers
                .iter()
                .filter(|(track, speaker)| {
                    named.contains(&format!("{job}:{track}:{speaker}"))
                        || named.contains(&format!("{job}:{speaker}"))
                })
                .count() as u32;
            SpeakerCounts {
                named: known,
                unnamed: total - known,
            }
        });
        let note = session
            .note_path
            .as_deref()
            .and_then(|path| sources::note(&paths.vault, path));
        let filled = note.as_ref().is_some_and(|n| n.filled);
        let folder = folders.get(&session.id);
        let prepared_note = note
            .as_ref()
            .is_some_and(|n| n.filled && before(n.modified, start));
        let prepared_folder = folder.is_some_and(|f| {
            f.files.iter().any(|file| before(file.modified, start))
                || f.references
                    .iter()
                    .any(|r| before(instant(&r.added_at), start))
        });
        let diagram = folder.is_some_and(|f| {
            f.files.iter().any(|file| sources::is_diagram(&file.name))
                || f.references.iter().any(|r| sources::is_diagram(&r.target))
        }) || session
            .note_id
            .as_ref()
            .is_some_and(|id| board.contains(id));
        let summary = session.meeting_id.as_ref().and_then(|m| summaries.get(m));
        let follow_ups = FollowUps {
            linked: linked.get(&session.id).copied().unwrap_or(0),
            actions: summary.map_or(0, |s| crate::summaries::prompt::action_items(s)),
        };
        MeetingSignals {
            session_id: session.id.clone(),
            transcript: run.is_some_and(|(_, run)| run.spoken),
            speakers,
            note: filled,
            preparation: prepared_note || prepared_folder,
            diagram,
            summary: summary.is_some(),
            follow_ups,
            generated_content: summary.is_some()
                || follow_ups.linked + follow_ups.actions > 0
                || diagram
                || filled,
            mark: marks.get(&session.id).copied(),
        }
    };
    Ok(sessions.iter().take(MAX_SESSIONS).map(signals_of).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn library_meeting_signals(
    app: tauri::AppHandle,
    state: tauri::State<'_, Library>,
    storage: tauri::State<'_, Arc<Storage>>,
) -> Result<SignalsReport, String> {
    let summaries_on = crate::summaries::allowed(&crate::titles::watch::load_settings(&app));
    let paths = state.paths(&storage)?;
    let sessions = tauri::async_runtime::spawn_blocking(move || collect(&paths))
        .await
        .map_err(|e| e.to_string())??;
    Ok(SignalsReport {
        summaries_on,
        sessions,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn library_set_meeting_mark(
    state: tauri::State<'_, Library>,
    storage: tauri::State<'_, Arc<Storage>>,
    session_id: String,
    mark: Option<Mark>,
) -> Result<(), String> {
    let paths = state.paths(&storage)?;
    tauri::async_runtime::spawn_blocking(move || marks::set(&paths.data, &session_id, mark))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
