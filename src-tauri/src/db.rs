//! SQLite + FTS5 layer. Index only; the filesystem is canonical.
//!
//! If `index.db` is deleted, it can be rebuilt from the vault's
//! `.md` files — see `rebuild_from_vault()`.

use std::path::Path;
use std::sync::Mutex;

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use shared::*;
use uuid::Uuid;

mod note_index;
pub(crate) use note_index::NoteIndexEntry;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS notes (
                id          TEXT PRIMARY KEY,
                path        TEXT NOT NULL UNIQUE,
                title       TEXT NOT NULL,
                tags_json   TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                id UNINDEXED,
                title,
                body,
                tokenize = 'unicode61 remove_diacritics 2'
            );

            CREATE TABLE IF NOT EXISTS meetings (
                id                 TEXT PRIMARY KEY,
                title              TEXT NOT NULL,
                started_at         TEXT NOT NULL,
                ended_at           TEXT,
                duration_seconds   INTEGER,
                participants_json  TEXT NOT NULL DEFAULT '[]',
                recording_path     TEXT,
                has_transcript     INTEGER NOT NULL DEFAULT 0,
                has_summary        INTEGER NOT NULL DEFAULT 0,
                source_app         TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_notes_updated
                ON notes(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_meetings_started
                ON meetings(started_at DESC);

            -- Wiki-links (spec 0013). `target_text` is the raw string
            -- inside `[[…]]`, `target_lc` is the lowercased lookup key.
            -- Resolution is done at query time against current note
            -- titles + path stems — no stale target_id to re-resolve
            -- on rename.
            CREATE TABLE IF NOT EXISTS links (
                source_id    TEXT NOT NULL,
                target_text  TEXT NOT NULL,
                target_lc    TEXT NOT NULL,
                FOREIGN KEY (source_id) REFERENCES notes(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_links_source
                ON links(source_id);
            CREATE INDEX IF NOT EXISTS idx_links_target_lc
                ON links(target_lc);
            "#,
        )?;
        Ok(())
    }

    // ---- Notes ----

    #[cfg(test)]
    pub fn upsert_note(&self, note: &Note, body: &str) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        note_index::write_note(&tx, note, body)?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_note(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let id_s = id.to_string();
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id_s])?;
        conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id_s])?;
        Ok(())
    }

    pub fn list_notes(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags_json, created_at, updated_at
             FROM notes
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_note)?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn get_note(&self, id: Uuid) -> Result<Option<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags_json, created_at, updated_at
             FROM notes WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id.to_string()], row_to_note)?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    /// Lookup by relative path. Used by daily-note creation to keep
    /// a stable file per day: we probe the index before writing so
    /// repeated opens return the same `Note`.
    pub fn get_note_by_path(&self, rel_path: &str) -> Result<Option<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags_json, created_at, updated_at
             FROM notes WHERE path = ?1",
        )?;
        let mut rows = stmt.query_map(params![rel_path], row_to_note)?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    // ---- Links (wiki-links, spec 0013) ----

    /// Replace all outgoing links from `source_id` with `targets`
    /// (raw `[[…]]` texts). Called on every note save — idempotent
    /// by construction because the old rows are wiped first.
    pub fn replace_links(&self, source_id: Uuid, targets: &[String]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let source = source_id.to_string();
        tx.execute("DELETE FROM links WHERE source_id = ?1", params![source])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO links (source_id, target_text, target_lc)
                 VALUES (?1, ?2, ?3)",
            )?;
            for target in targets {
                let trimmed = target.trim();
                if trimmed.is_empty() {
                    continue;
                }
                stmt.execute(params![source, trimmed, trimmed.to_lowercase()])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Notes that link to any of the given lowercased lookup keys
    /// (typically the target note's title + path stem). Ordered by
    /// recency so the sidebar lists the most recent linker first.
    pub fn backlinks_for_keys(&self, keys: &[String]) -> Result<Vec<Note>> {
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders = (0..keys.len())
            .map(|i| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT DISTINCT n.id, n.path, n.title, n.tags_json,
                    n.created_at, n.updated_at
             FROM links l
             JOIN notes n ON n.id = l.source_id
             WHERE l.target_lc IN ({})
             ORDER BY n.updated_at DESC",
            placeholders
        );
        let lowered: Vec<String> = keys.iter().map(|k| k.to_lowercase()).collect();
        let params: Vec<&dyn rusqlite::ToSql> =
            lowered.iter().map(|k| k as &dyn rusqlite::ToSql).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params.as_slice(), row_to_note)?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    // ---- Tags ----

    pub fn list_tags(&self) -> Result<Vec<TagCount>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT j.value AS tag, COUNT(*) AS cnt
             FROM notes, json_each(notes.tags_json) j
             GROUP BY j.value
             ORDER BY cnt DESC, j.value ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(TagCount {
                tag: r.get::<_, String>(0)?,
                count: r.get::<_, i64>(1)? as u32,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    // Case-sensitive on purpose: `#Project` and `#project` are
    // distinct in `extract_tags`, so rewriting here would hide
    // whichever form the user typed.
    pub fn list_notes_by_tag(&self, tag: &str) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT n.id, n.path, n.title, n.tags_json,
                    n.created_at, n.updated_at
             FROM notes n, json_each(n.tags_json) j
             WHERE j.value = ?1
             ORDER BY n.updated_at DESC",
        )?;
        let rows = stmt.query_map(params![tag], row_to_note)?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let q = format!("\"{}\"", query.replace('"', ""));
        let mut stmt = conn.prepare(
            "SELECT n.id, n.path, n.title, n.tags_json, n.created_at, n.updated_at
             FROM notes_fts f
             JOIN notes n ON n.id = f.id
             WHERE notes_fts MATCH ?1
             ORDER BY rank",
        )?;
        let rows = stmt.query_map(params![q], row_to_note)?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    // ---- Meetings ----

    pub fn upsert_meeting(&self, m: &Meeting) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO meetings
                (id, title, started_at, ended_at, duration_seconds,
                 participants_json, recording_path, has_transcript, has_summary, source_app)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                ended_at = excluded.ended_at,
                duration_seconds = excluded.duration_seconds,
                participants_json = excluded.participants_json,
                recording_path = excluded.recording_path,
                has_transcript = excluded.has_transcript,
                has_summary = excluded.has_summary,
                source_app = excluded.source_app",
            params![
                m.id.to_string(),
                m.title,
                m.started_at.to_rfc3339(),
                m.ended_at.map(|d| d.to_rfc3339()),
                m.duration_seconds,
                serde_json::to_string(&m.participants)?,
                m.recording_path,
                m.has_transcript as i32,
                m.has_summary as i32,
                m.source_app,
            ],
        )?;
        Ok(())
    }

    pub fn list_meetings(&self) -> Result<Vec<Meeting>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, started_at, ended_at, duration_seconds,
                    participants_json, recording_path, has_transcript, has_summary, source_app
             FROM meetings
             ORDER BY started_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_meeting)?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn get_meeting(&self, id: Uuid) -> Result<Option<Meeting>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, started_at, ended_at, duration_seconds,
                    participants_json, recording_path, has_transcript, has_summary, source_app
             FROM meetings WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id.to_string()], row_to_meeting)?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }
}

fn row_to_note(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let id: String = r.get(0)?;
    let created_at: String = r.get(4)?;
    let updated_at: String = r.get(5)?;
    let tags_json: String = r.get(3)?;
    Ok(Note {
        id: Uuid::parse_str(&id).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?,
        path: r.get(1)?,
        title: r.get(2)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        created_at: parse_dt(&created_at),
        updated_at: parse_dt(&updated_at),
    })
}

fn row_to_meeting(r: &rusqlite::Row) -> rusqlite::Result<Meeting> {
    let id: String = r.get(0)?;
    let started_at: String = r.get(2)?;
    let ended_at: Option<String> = r.get(3)?;
    let participants_json: String = r.get(5)?;
    let has_transcript: i32 = r.get(7)?;
    let has_summary: i32 = r.get(8)?;

    Ok(Meeting {
        id: Uuid::parse_str(&id).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?,
        title: r.get(1)?,
        started_at: parse_dt(&started_at),
        ended_at: ended_at.map(|s| parse_dt(&s)),
        duration_seconds: r.get(4)?,
        participants: serde_json::from_str(&participants_json).unwrap_or_default(),
        recording_path: r.get(6)?,
        has_transcript: has_transcript != 0,
        has_summary: has_summary != 0,
        source_app: r.get(9)?,
    })
}

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fresh_db() -> (TempDir, Db) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = Db::open(&dir.path().join("index.db")).expect("open db");
        (dir, db)
    }

    fn sample_note(title: &str, path: &str, updated: &str) -> Note {
        Note {
            id: Uuid::new_v4(),
            title: title.to_string(),
            path: path.to_string(),
            tags: vec![],
            created_at: Utc::now(),
            updated_at: updated.parse::<DateTime<Utc>>().expect("rfc3339 timestamp"),
        }
    }

    #[test]
    fn open_creates_schema_idempotently() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.db");
        // Opening twice on the same file must not fail — migrate() uses
        // IF NOT EXISTS, so a second boot should be a no-op.
        let _first = Db::open(&path).unwrap();
        drop(_first);
        let _second = Db::open(&path).unwrap();
    }

    #[test]
    fn upsert_get_roundtrip() {
        let (_tmp, db) = fresh_db();
        let mut note = sample_note("Hello", "notes/hello.md", "2026-04-18T10:00:00Z");
        note.tags = vec!["work".into(), "meeting".into()];

        db.upsert_note(&note, "# Hello\n\nbody").unwrap();

        let got = db.get_note(note.id).unwrap().expect("note exists");
        assert_eq!(got.id, note.id);
        assert_eq!(got.title, "Hello");
        assert_eq!(got.path, "notes/hello.md");
        assert_eq!(got.tags, vec!["work", "meeting"]);
    }

    #[test]
    fn list_notes_orders_by_updated_desc() {
        let (_tmp, db) = fresh_db();
        let older = sample_note("old", "notes/old.md", "2026-01-01T00:00:00Z");
        let newer = sample_note("new", "notes/new.md", "2026-04-01T00:00:00Z");
        db.upsert_note(&older, "a").unwrap();
        db.upsert_note(&newer, "b").unwrap();

        let listed = db.list_notes().unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].title, "new");
        assert_eq!(listed[1].title, "old");
    }

    #[test]
    fn delete_removes_from_notes_and_fts() {
        let (_tmp, db) = fresh_db();
        let note = sample_note("bye", "notes/bye.md", "2026-04-18T10:00:00Z");
        db.upsert_note(&note, "farewell content").unwrap();
        assert!(db.get_note(note.id).unwrap().is_some());

        db.delete_note(note.id).unwrap();

        assert!(db.get_note(note.id).unwrap().is_none());
        // FTS entry is gone too — searching the body yields nothing.
        assert!(db.search_notes("farewell").unwrap().is_empty());
    }

    #[test]
    fn search_matches_body_via_fts() {
        let (_tmp, db) = fresh_db();
        let note = sample_note("Journal", "notes/journal.md", "2026-04-18T10:00:00Z");
        db.upsert_note(&note, "meeting with the robotics team")
            .unwrap();

        let hits = db.search_notes("robotics").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, note.id);

        assert!(db.search_notes("nonexistent").unwrap().is_empty());
    }

    // ---- Tags ----

    #[test]
    fn list_tags_aggregates_counts_and_orders_by_popularity() {
        let (_tmp, db) = fresh_db();
        let mut a = sample_note("a", "notes/a.md", "2026-04-19T00:00:00Z");
        a.tags = vec!["project".into(), "work".into()];
        db.upsert_note(&a, "").unwrap();
        let mut b = sample_note("b", "notes/b.md", "2026-04-19T00:00:00Z");
        b.tags = vec!["work".into(), "personal".into()];
        db.upsert_note(&b, "").unwrap();
        let mut c = sample_note("c", "notes/c.md", "2026-04-19T00:00:00Z");
        c.tags = vec!["work".into()];
        db.upsert_note(&c, "").unwrap();

        let tags = db.list_tags().unwrap();
        assert_eq!(tags.len(), 3);
        assert_eq!(tags[0].tag, "work");
        assert_eq!(tags[0].count, 3);
        // "personal" and "project" tie at 1 → alphabetical.
        assert_eq!(tags[1].tag, "personal");
        assert_eq!(tags[2].tag, "project");
    }

    #[test]
    fn list_tags_empty_vault_returns_empty() {
        let (_tmp, db) = fresh_db();
        assert!(db.list_tags().unwrap().is_empty());
    }

    #[test]
    fn list_notes_by_tag_returns_matching_notes_most_recent_first() {
        let (_tmp, db) = fresh_db();
        let mut older = sample_note("old", "notes/old.md", "2026-01-01T00:00:00Z");
        older.tags = vec!["work".into()];
        db.upsert_note(&older, "").unwrap();
        let mut newer = sample_note("new", "notes/new.md", "2026-04-01T00:00:00Z");
        newer.tags = vec!["work".into(), "urgent".into()];
        db.upsert_note(&newer, "").unwrap();
        let mut other = sample_note("other", "notes/other.md", "2026-04-02T00:00:00Z");
        other.tags = vec!["personal".into()];
        db.upsert_note(&other, "").unwrap();

        let hits = db.list_notes_by_tag("work").unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "new");
        assert_eq!(hits[1].title, "old");
    }

    #[test]
    fn list_notes_by_tag_is_case_sensitive() {
        let (_tmp, db) = fresh_db();
        let mut note = sample_note("n", "notes/n.md", "2026-04-19T00:00:00Z");
        note.tags = vec!["Project".into()];
        db.upsert_note(&note, "").unwrap();

        assert_eq!(db.list_notes_by_tag("Project").unwrap().len(), 1);
        assert_eq!(db.list_notes_by_tag("project").unwrap().len(), 0);
    }

    // ---- Links ----

    fn upsert_sample(db: &Db, title: &str, path: &str, body: &str) -> Uuid {
        let note = sample_note(title, path, "2026-04-18T10:00:00Z");
        db.upsert_note(&note, body).unwrap();
        note.id
    }

    #[test]
    fn replace_links_inserts_then_overwrites() {
        let (_tmp, db) = fresh_db();
        let source = upsert_sample(&db, "Source", "notes/source.md", "body");

        db.replace_links(source, &["Daily Notes".into(), "Meetings".into()])
            .unwrap();
        // Second call replaces, doesn't append.
        db.replace_links(source, &["Meetings".into(), "Projects".into()])
            .unwrap();

        let backlinks = db.backlinks_for_keys(&["Meetings".into()]).unwrap();
        assert_eq!(backlinks.len(), 1);

        // Daily Notes no longer tracked → no backlinks by that key.
        assert!(db
            .backlinks_for_keys(&["Daily Notes".into()])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn backlinks_are_case_insensitive_and_deduped() {
        let (_tmp, db) = fresh_db();
        let source = upsert_sample(&db, "Source", "notes/source.md", "body");
        // Same target repeated — linker shows up once.
        db.replace_links(source, &["Daily".into(), "daily".into(), "DAILY".into()])
            .unwrap();

        let hits = db.backlinks_for_keys(&["Daily".into()]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Source");
    }

    #[test]
    fn backlinks_matches_any_of_multiple_keys() {
        let (_tmp, db) = fresh_db();
        let src1 = upsert_sample(&db, "One", "notes/one.md", "");
        let src2 = upsert_sample(&db, "Two", "notes/two.md", "");
        db.replace_links(src1, &["my-note".into()]).unwrap();
        db.replace_links(src2, &["My Note".into()]).unwrap();

        let hits = db
            .backlinks_for_keys(&["my-note".into(), "My Note".into()])
            .unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn backlinks_empty_keys_returns_empty() {
        let (_tmp, db) = fresh_db();
        let _src = upsert_sample(&db, "One", "notes/one.md", "");
        assert!(db.backlinks_for_keys(&[]).unwrap().is_empty());
    }

    #[test]
    fn deleting_note_cascades_its_links() {
        let (_tmp, db) = fresh_db();
        let src = upsert_sample(&db, "Source", "notes/source.md", "body");
        db.replace_links(src, &["Target".into()]).unwrap();
        db.delete_note(src).unwrap();
        assert!(db
            .backlinks_for_keys(&["Target".into()])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn replace_links_ignores_empty_and_whitespace_targets() {
        let (_tmp, db) = fresh_db();
        let src = upsert_sample(&db, "Source", "notes/source.md", "");
        db.replace_links(src, &["".into(), "   ".into(), "Real".into()])
            .unwrap();
        assert!(db.backlinks_for_keys(&["".into()]).unwrap().is_empty());
        assert_eq!(db.backlinks_for_keys(&["Real".into()]).unwrap().len(), 1);
    }

    #[test]
    fn upsert_is_idempotent_by_id() {
        let (_tmp, db) = fresh_db();
        let mut note = sample_note("t", "notes/t.md", "2026-04-18T10:00:00Z");
        db.upsert_note(&note, "v1").unwrap();

        note.title = "t2".into();
        db.upsert_note(&note, "v2").unwrap();

        let listed = db.list_notes().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "t2");
        // New body is indexed; old body is not.
        assert_eq!(db.search_notes("v2").unwrap().len(), 1);
        assert_eq!(db.search_notes("v1").unwrap().len(), 0);
    }
}
