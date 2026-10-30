//! Atomic publication of the rebuildable note index.
use super::Db;
use anyhow::{ensure, Result};
use rusqlite::{params, Connection};
use shared::Note;
use std::collections::HashSet;

pub(crate) struct NoteIndexEntry {
    pub note: Note,
    pub body: String,
    pub links: Vec<String>,
}

impl Db {
    /// Only one exact indexed body can establish continuity for a headerless file.
    pub fn indexed_note_body(&self, id: uuid::Uuid) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT body FROM notes_fts WHERE id = ?1")?;
        let mut rows = stmt.query([id.to_string()])?;
        let body = match rows.next()? {
            Some(row) => row.get::<_, String>(0)?,
            None => return Ok(None),
        };
        if rows.next()?.is_some() {
            return Ok(None);
        }
        Ok(Some(body))
    }

    pub fn save_note(&self, note: &Note, body: &str, links: &[String]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let prior_path: Option<String> = tx
            .query_row(
                "SELECT path FROM notes WHERE id = ?1",
                [note.id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        if prior_path.as_deref().is_some_and(|p| p != note.path) {
            return Err(anyhow::Error::new(crate::note_errors::NoteIdentityConflict)
                .context("note UUID already belongs to another path"));
        }
        write_note(&tx, note, body)?;
        write_links(&tx, note, links)?;
        tx.commit()?;
        Ok(())
    }

    /// Root verified ownership and the absence of the old path while holding
    /// note_writes. Keep ordinary save_note's identity/path refusal unchanged.
    pub(crate) fn publish_reserved_note_index(
        &self,
        note: &Note,
        body: &str,
        links: &[String],
        expected_path: Option<&str>,
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let current: Option<String> = tx
            .query_row(
                "SELECT path FROM notes WHERE id=?1",
                [note.id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        ensure!(
            current.as_deref() == expected_path,
            crate::note_errors::NoteIdentityConflict
        );
        write_note(&tx, note, body)?;
        write_links(&tx, note, links)?;
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn replace_note_index(&self, entries: &[NoteIndexEntry]) -> Result<()> {
        let mut ids = HashSet::new();
        let mut paths = HashSet::new();
        for entry in entries {
            ensure!(ids.insert(entry.note.id), "duplicate note UUID");
            ensure!(paths.insert(&entry.note.path), "duplicate note path");
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM links", [])?;
        tx.execute("DELETE FROM notes_fts", [])?;
        tx.execute("DELETE FROM notes", [])?;
        for entry in entries {
            write_note(&tx, &entry.note, &entry.body)?;
            write_links(&tx, &entry.note, &entry.links)?;
        }
        tx.commit()?;
        Ok(())
    }
}

use rusqlite::OptionalExtension;

pub(super) fn write_note(conn: &Connection, note: &Note, body: &str) -> Result<()> {
    let tags_json = serde_json::to_string(&note.tags)?;
    conn.execute(
        "INSERT INTO notes (id, path, title, tags_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            path       = excluded.path,
            title      = excluded.title,
            tags_json  = excluded.tags_json,
            updated_at = excluded.updated_at",
        params![
            note.id.to_string(),
            note.path,
            note.title,
            tags_json,
            note.created_at.to_rfc3339(),
            note.updated_at.to_rfc3339(),
        ],
    )?;

    // FTS: delete + insert (simpler than upsert)
    conn.execute(
        "DELETE FROM notes_fts WHERE id = ?1",
        params![note.id.to_string()],
    )?;
    conn.execute(
        "INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)",
        params![note.id.to_string(), note.title, body],
    )?;
    Ok(())
}

fn write_links(conn: &Connection, note: &Note, links: &[String]) -> Result<()> {
    let source = note.id.to_string();
    conn.execute("DELETE FROM links WHERE source_id = ?1", [&source])?;
    let mut stmt =
        conn.prepare("INSERT INTO links (source_id, target_text, target_lc) VALUES (?1, ?2, ?3)")?;
    for target in links {
        let target = target.trim();
        if !target.is_empty() {
            stmt.execute(params![source, target, target.to_lowercase()])?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn entry(title: &str) -> NoteIndexEntry {
        NoteIndexEntry {
            note: Note {
                id: Uuid::new_v4(),
                title: title.into(),
                path: format!("notes/{title}.md"),
                tags: vec![],
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            body: format!("search{title}"),
            links: vec!["Target".into()],
        }
    }

    #[test]
    fn rebuild_sql_failure_rolls_back_notes_fts_and_links_together() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("index.db")).unwrap();
        let old = entry("old");
        db.save_note(&old.note, &old.body, &old.links).unwrap();
        db.conn
            .lock()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER reject_note BEFORE INSERT ON notes WHEN NEW.title = 'bad'
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
            )
            .unwrap();
        assert!(db
            .replace_note_index(&[entry("good"), entry("bad")])
            .is_err());
        assert_eq!(db.list_notes().unwrap()[0].id, old.note.id);
        assert_eq!(db.search_notes("searchold").unwrap()[0].id, old.note.id);
        assert!(db.search_notes("searchgood").unwrap().is_empty());
        assert_eq!(
            db.backlinks_for_keys(&["Target".into()]).unwrap()[0].id,
            old.note.id
        );
    }

    #[test]
    fn save_link_failure_rolls_back_note_and_fts_updates() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("index.db")).unwrap();
        let mut note = entry("old");
        db.save_note(&note.note, &note.body, &note.links).unwrap();
        db.conn
            .lock()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER reject_link BEFORE INSERT ON links
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
            )
            .unwrap();
        note.note.title = "changed".into();
        assert!(db.save_note(&note.note, "newbody", &note.links).is_err());
        assert_eq!(db.list_notes().unwrap()[0].title, "old");
        assert_eq!(db.search_notes("searchold").unwrap().len(), 1);
        assert!(db.search_notes("newbody").unwrap().is_empty());
        assert_eq!(db.backlinks_for_keys(&["Target".into()]).unwrap().len(), 1);
    }
}
