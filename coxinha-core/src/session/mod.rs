//! Local sessions, independent of audio. References never create or rewrite notes.
use crate::store::Store;
use anyhow::{ensure, Context, Result};
use rusqlite::{params, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Planned,
    Active,
    Completed,
    Cancelled,
}
impl SessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Dates are optional UTC instants, not provider identity or capture state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NewSession {
    pub title: String,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub status: SessionStatus,
}
impl NewSession {
    pub fn manual(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            starts_at: None,
            ends_at: None,
            status: SessionStatus::Planned,
        }
    }
    fn validate(&self) -> Result<()> {
        ensure!(!self.title.trim().is_empty(), "session title is required");
        for date in [&self.starts_at, &self.ends_at].into_iter().flatten() {
            ensure!(
                valid_utc(date),
                "session date requires a real UTC YYYY-MM-DDTHH:MM:SSZ instant"
            );
        }
        if let Some(end) = &self.ends_at {
            ensure!(
                self.starts_at.as_ref().is_some_and(|start| start <= end),
                "session end requires a start no later than end"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonalNoteRef {
    pub id: Uuid,
    pub relative_path: String,
}
impl PersonalNoteRef {
    /// Shared cross-platform contract, checked before filesystem/index publication.
    pub fn validate(&self) -> Result<()> {
        ensure!(!self.id.is_nil(), "personal note UUID must not be nil");
        let path = &self.relative_path;
        let parts: Vec<_> = path.split('/').collect();
        ensure!(
            parts.len() >= 2
                && matches!(parts[0], "notes" | "daily")
                && path.ends_with(".md")
                && !path.contains(['\\', ':'])
                && !path.chars().any(char::is_control)
                && parts.iter().all(|p| !p.is_empty()
                    && *p != "."
                    && *p != ".."
                    && p.trim() == *p
                    && !p.ends_with('.')),
            "personal note requires a safe notes/ or daily/ relative Markdown path"
        );
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionOrigin {
    Manual,
    Recording,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub status: SessionStatus,
    pub origin: SessionOrigin,
    pub meeting_id: Option<String>,
    pub personal_note: Option<PersonalNoteRef>,
    pub created_at: String,
}

fn valid_utc(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7 | 10 | 13 | 16 | 19) || c.is_ascii_digit())
    {
        return false;
    }
    let num = |range: std::ops::Range<usize>| value[range].parse::<u32>().unwrap();
    let (year, month, day) = (num(0..4), num(5..7), num(8..10));
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    year > 0 && day > 0 && day <= days && num(11..13) < 24 && num(14..16) < 60 && num(17..19) < 60
}

const SELECT: &str = "SELECT id,title,starts_at,ends_at,status,origin,meeting_id,note_id,note_path,created_at FROM session";
fn read_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    let status: String = row.get(4)?;
    let origin: String = row.get(5)?;
    let invalid = || rusqlite::Error::InvalidQuery;
    let note_id: Option<String> = row.get(7)?;
    let note_path: Option<String> = row.get(8)?;
    let personal_note = match (note_id, note_path) {
        (None, None) => None,
        (Some(id), Some(relative_path)) => Some(PersonalNoteRef {
            id: Uuid::parse_str(&id).map_err(|_| invalid())?,
            relative_path,
        }),
        _ => return Err(invalid()),
    };
    Ok(Session {
        id: row.get(0)?,
        title: row.get(1)?,
        starts_at: row.get(2)?,
        ends_at: row.get(3)?,
        status: match status.as_str() {
            "planned" => SessionStatus::Planned,
            "active" => SessionStatus::Active,
            "completed" => SessionStatus::Completed,
            "cancelled" => SessionStatus::Cancelled,
            _ => return Err(invalid()),
        },
        origin: match origin.as_str() {
            "manual" => SessionOrigin::Manual,
            "recording" => SessionOrigin::Recording,
            _ => return Err(invalid()),
        },
        meeting_id: row.get(6)?,
        personal_note,
        created_at: row.get(9)?,
    })
}

/// Called only inside the meeting creation/migration transaction. Existing UUIDs
/// remain canonical; the session UUID namespace is independent of meeting UUIDs.
pub(crate) fn insert_recording_session(tx: &Transaction<'_>, meeting: &str) -> Result<()> {
    tx.execute("INSERT INTO session(id,title,origin,meeting_id,created_at) SELECT id,title,'recording',id,created_at FROM meeting WHERE id=?1", [meeting])?;
    Ok(())
}

impl Store {
    pub fn create_session(&self, input: &NewSession) -> Result<Session> {
        self.create_session_with_id(Uuid::new_v4(), input)
    }

    /// Retry with a reserved UUID. Conflicting metadata never overwrites user edits.
    pub fn create_session_with_id(&self, id: Uuid, input: &NewSession) -> Result<Session> {
        input.validate()?;
        ensure!(!id.is_nil(), "session UUID must not be nil");
        let id = id.to_string();
        self.db.execute("INSERT INTO session(id,title,starts_at,ends_at,status,origin) VALUES(?1,?2,?3,?4,?5,'manual') ON CONFLICT(id) DO NOTHING",
            params![id, input.title, input.starts_at, input.ends_at, input.status.as_str()])?;
        let session = self.session(&id)?.context("created session is missing")?;
        ensure!(
            session.origin == SessionOrigin::Manual
                && session.title == input.title
                && session.starts_at == input.starts_at
                && session.ends_at == input.ends_at
                && session.status == input.status,
            "session UUID already exists with different metadata or origin"
        );
        Ok(session)
    }

    /// Metadata only. No transition starts capture, queues jobs, or changes links.
    pub fn update_session(&self, id: &str, input: &NewSession) -> Result<()> {
        input.validate()?;
        ensure!(
            self.db.execute(
                "UPDATE session SET title=?2,starts_at=?3,ends_at=?4,status=?5 WHERE id=?1",
                params![
                    id,
                    input.title,
                    input.starts_at,
                    input.ends_at,
                    input.status.as_str()
                ]
            )? == 1,
            "session not found"
        );
        Ok(())
    }

    /// Changes the title only while it still equals `expected`, so a title the
    /// user typed meanwhile always wins (spec 0097 P4, single statement).
    pub fn retitle_if(&self, id: &str, expected: &str, title: &str) -> Result<bool> {
        NewSession::manual(title).validate()?;
        Ok(self.db.execute(
            "UPDATE session SET title=?3 WHERE id=?1 AND title=?2",
            params![id, expected, title],
        )? == 1)
    }

    pub fn session(&self, id: &str) -> Result<Option<Session>> {
        Ok(self
            .db
            .query_row(&format!("{SELECT} WHERE id=?1"), [id], read_session)
            .optional()?)
    }

    pub fn session_for_meeting(&self, meeting: &str) -> Result<Option<Session>> {
        Ok(self
            .db
            .query_row(
                &format!("{SELECT} WHERE meeting_id=?1"),
                [meeting],
                read_session,
            )
            .optional()?)
    }

    /// Creation order, latest first; date/status are independent user metadata.
    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut query = self.db.prepare(&format!("{SELECT} ORDER BY rowid DESC"))?;
        let rows = query.query_map([], read_session)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn attach_meeting(&self, session: &str, meeting: &str) -> Result<()> {
        ensure!(self.db.execute("UPDATE session SET meeting_id=?2 WHERE id=?1 AND (meeting_id IS NULL OR meeting_id=?2) AND EXISTS(SELECT 1 FROM meeting WHERE id=?2)",
            params![session, meeting])? == 1, "missing session/meeting or session already bound to another meeting");
        Ok(())
    }

    /// Stores a reference supplied by the root backend after identity verification.
    /// No filesystem operation or cross-database publication is performed here.
    pub fn bind_session_note(&self, session: &str, note: &PersonalNoteRef) -> Result<()> {
        note.validate()?;
        ensure!(self.db.execute("UPDATE session SET note_id=?2,note_path=?3 WHERE id=?1 AND (note_id IS NULL OR (note_id=?2 AND note_path=?3))",
            params![session, note.id.to_string(), note.relative_path])? == 1, "missing session or personal note already bound differently");
        Ok(())
    }

    /// Manual-first flow: the existing session owns the newly created meeting.
    pub fn create_meeting_for_session(&self, session: &str, title: &str) -> Result<String> {
        self.create_meeting_in_session(title, Some(session))
    }
}

#[cfg(test)]
mod migration_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod concurrency_tests;
#[cfg(test)]
mod validation_tests;

#[cfg(test)]
mod hot_journal_tests;

#[cfg(test)]
mod intent_migration_tests;
pub mod note_intent;
