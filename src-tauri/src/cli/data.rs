//! Read-only views of the library, the vault index and the Outlook cache.
//! The running app holds the library lock, so nothing here uses `Store`.
use super::paths::Paths;
use crate::calendar::{Candidate, Event, Snapshot};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::path::Path;

pub fn open_read_only(path: &Path) -> Result<Connection, String> {
    if !path.is_file() {
        return Err(format!("{} not found", path.display()));
    }
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("cannot open {}: {e}", path.display()))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub status: String,
    pub meeting_id: Option<String>,
    pub note_id: Option<String>,
    pub note_path: Option<String>,
    pub created_at: String,
    /// The recording's start, the date the app shows when nothing is scheduled.
    pub recorded_at: Option<String>,
}

pub fn sessions(db: &Connection) -> Result<Vec<Session>, String> {
    let mut q = db
        .prepare("SELECT s.id,s.title,s.starts_at,s.ends_at,s.status,s.meeting_id,s.note_id,s.note_path,s.created_at,m.created_at FROM session s LEFT JOIN meeting m ON m.id=s.meeting_id ORDER BY COALESCE(s.starts_at,m.created_at,s.created_at) DESC")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok(Session {
                id: r.get(0)?,
                title: r.get(1)?,
                starts_at: r.get(2)?,
                ends_at: r.get(3)?,
                status: r.get(4)?,
                meeting_id: r.get(5)?,
                note_id: r.get(6)?,
                note_path: r.get(7)?,
                created_at: r.get(8)?,
                recorded_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// Names the owner gave the meeting's participants (`participant_context`).
pub fn participants(profiles: Option<&Connection>, meeting: Option<&str>) -> Vec<Candidate> {
    let (Some(profiles), Some(meeting)) = (profiles, meeting) else {
        return Vec::new();
    };
    profiles
        .query_row(
            "SELECT participants_json FROM participant_context WHERE meeting_id=?1",
            [meeting],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub fn outlook(paths: &Paths) -> Snapshot {
    std::fs::read(paths.outlook_cache())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedNote {
    pub id: String,
    pub title: String,
    pub path: String,
}

pub fn notes(paths: &Paths) -> Result<Vec<IndexedNote>, String> {
    let db = open_read_only(&paths.index_db())?;
    let mut q = db
        .prepare("SELECT id,title,path FROM notes ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok(IndexedNote {
                id: r.get(0)?,
                title: r.get(1)?,
                path: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// Note ids that are activities (`card` items) on the board.
pub fn board_cards(paths: &Paths) -> Vec<String> {
    let Ok(bytes) = std::fs::read(paths.vault.join(".coxinha/board.json")) else {
        return Vec::new();
    };
    let Ok(board) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Vec::new();
    };
    board["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["kind"] == "card")
        .filter_map(|item| item["noteId"].as_str().map(str::to_string))
        .collect()
}

/// A Markdown note without its YAML frontmatter.
pub fn note_body(paths: &Paths, relative: &str) -> Option<String> {
    let path = paths.vault.join(relative);
    if !path.starts_with(&paths.vault) || relative.contains("..") {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    Some(strip_frontmatter(&raw).trim().to_string())
}

pub fn strip_frontmatter(raw: &str) -> &str {
    let Some(rest) = raw.strip_prefix("---\n") else {
        return raw;
    };
    match rest.find("\n---\n") {
        Some(end) => &rest[end + 5..],
        None if rest.ends_with("\n---") => "",
        None => raw,
    }
}

pub type CalendarEvent = Event;
