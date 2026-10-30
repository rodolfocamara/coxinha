use anyhow::{bail, ensure, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

#[path = "session/mod.rs"]
pub mod session;

pub mod transcript_summary;

#[derive(Clone, Copy)]
enum DatabaseKind {
    Meetings,
    Profiles,
}
impl DatabaseKind {
    fn maximum_version(self) -> u32 {
        match self {
            Self::Meetings => 5,
            Self::Profiles => 4,
        }
    }
    fn validate_version(self, db: &Connection) -> Result<u32> {
        let version: u32 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
        let maximum = self.maximum_version();
        ensure!(
            version <= maximum,
            "database version {version} is newer than supported version {maximum}"
        );
        Ok(version)
    }
    fn preflight(self, path: &Path) -> Result<()> {
        if path.exists() {
            // Reading user_version may first recover a hot rollback journal.
            // Recovery writes are allowed here; schema migrations still wait for
            // both database version checks in Store::open to succeed.
            let db = Connection::open(path)?;
            self.validate_version(&db)?;
        }
        Ok(())
    }
}

pub struct Store {
    pub(crate) db: Connection,
    pub(crate) profiles: Connection,
    pub root: PathBuf,
    _lock: std::fs::File,
}

fn migrate(path: &Path, schema: &str, kind: DatabaseKind) -> Result<Connection> {
    let mut db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.pragma_update(None, "foreign_keys", true)?;
    let version = kind.validate_version(&db)?;
    if version == 0 {
        let tx = db.transaction()?;
        tx.execute_batch(schema)?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }
    if version < 2 {
        let tx = db.transaction()?;
        if matches!(kind, DatabaseKind::Meetings) {
            tx.execute_batch(include_str!("processing/schema.sql"))?;
        } else if matches!(kind, DatabaseKind::Profiles) {
            tx.execute_batch(include_str!("processing/private.sql"))?;
        }
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }
    if version < 3 {
        let tx = db.transaction()?;
        if matches!(kind, DatabaseKind::Profiles) {
            tx.execute_batch("CREATE TABLE participant_context(meeting_id TEXT PRIMARY KEY, participants_json TEXT NOT NULL); CREATE TABLE calibration_policy(id TEXT PRIMARY KEY, version TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES embedding_space(id), calibration_json TEXT NOT NULL,evidence_json TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1))); CREATE UNIQUE INDEX active_calibration_space ON calibration_policy(space_id) WHERE active=1;")?;
        }
        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;
    }
    if matches!(kind, DatabaseKind::Meetings) && version < 4 {
        let tx = db.transaction()?;
        tx.execute_batch(include_str!("session/schema.sql"))?;
        tx.execute_batch("INSERT INTO session(id,title,origin,meeting_id,created_at) SELECT id,title,'recording',id,created_at FROM meeting ORDER BY rowid;")?;
        tx.pragma_update(None, "user_version", 4)?;
        tx.commit()?;
    }
    if matches!(kind, DatabaseKind::Meetings) && version < 5 {
        let tx = db.transaction()?;
        tx.execute_batch(include_str!("session/note_intent.sql"))?;
        tx.pragma_update(None, "user_version", 5)?;
        tx.commit()?;
    }
    if matches!(kind, DatabaseKind::Profiles) && version < 4 {
        let tx = db.transaction()?;
        tx.execute_batch(include_str!("processing/publication.sql"))?;
        tx.pragma_update(None, "user_version", 4)?;
        tx.commit()?;
    }
    Ok(db)
}

impl Store {
    /// Caller selects a new library directory; never opens the legacy notes index.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        std::fs::create_dir_all(root.join("private"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root.join("private"), std::fs::Permissions::from_mode(0o700))?;
        }
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("library.lock"))?;
        lock.try_lock()
            .map_err(|e| anyhow::anyhow!("library already open: {e}"))?;
        // Refuse either future schema before migrating either database. The two
        // files still have independent transactional migrations, not one commit.
        DatabaseKind::Meetings.preflight(&root.join("meetings.db"))?;
        DatabaseKind::Profiles.preflight(&root.join("private/profiles.db"))?;
        let db = migrate(
            &root.join("meetings.db"),
            include_str!("schema.sql"),
            DatabaseKind::Meetings,
        )?;
        let profiles = migrate(
            &root.join("private/profiles.db"),
            include_str!("profiles.sql"),
            DatabaseKind::Profiles,
        )?;
        Ok(Self {
            db,
            profiles,
            root,
            _lock: lock,
        })
    }

    pub fn create_meeting(&self, title: &str) -> Result<String> {
        self.create_meeting_in_session(title, None)
    }

    fn create_meeting_in_session(&self, title: &str, session: Option<&str>) -> Result<String> {
        ensure!(!title.trim().is_empty(), "meeting title is required");
        let id = uuid::Uuid::new_v4().to_string();
        let tx = self.db.unchecked_transaction()?;
        if let Some(session) = session {
            let existing: Option<(String, String)> = tx.query_row(
                "SELECT meeting.id,meeting.title FROM session JOIN meeting ON meeting.id=session.meeting_id WHERE session.id=?1",
                [session], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            if let Some((meeting, existing_title)) = existing {
                ensure!(
                    existing_title == title,
                    "session already has a meeting with a different title"
                );
                tx.commit()?;
                return Ok(meeting);
            }
        }
        tx.execute(
            "INSERT INTO meeting(id,title) VALUES(?1,?2)",
            params![id, title],
        )?;
        if let Some(session) = session {
            ensure!(
                tx.execute(
                    "UPDATE session SET meeting_id=?2 WHERE id=?1 AND meeting_id IS NULL",
                    params![session, id]
                )? == 1,
                "session missing or already has a meeting"
            );
        } else {
            self::session::insert_recording_session(&tx, &id)?;
        }
        let directory = self.root.join("raw").join(&id);
        std::fs::create_dir_all(&directory)?;
        if let Err(error) = tx.commit() {
            std::fs::remove_dir_all(directory)?;
            return Err(error.into());
        }
        Ok(id)
    }

    pub fn list_meetings(&self) -> Result<Vec<(String, String)>> {
        let mut q = self
            .db
            .prepare("SELECT id,title FROM meeting ORDER BY rowid DESC")?;
        let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn meeting_summaries(&self) -> Result<Vec<serde_json::Value>> {
        let mut query = self
            .db
            .prepare("SELECT id,title,created_at,capture_state FROM meeting ORDER BY rowid DESC")?;
        let rows = query.query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, String>(2)?, "captureState": r.get::<_, String>(3)?
            }))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn edit(&self, meeting: &str, target: &str, body: &str) -> Result<i64> {
        self.db.execute(
            "INSERT INTO human_edit(meeting_id,target,body) VALUES(?1,?2,?3)",
            params![meeting, target, body],
        )?;
        Ok(self.db.last_insert_rowid())
    }

    pub fn latest_edit(&self, meeting: &str, target: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        Ok(self.db.query_row("SELECT body FROM human_edit WHERE meeting_id=?1 AND target=?2 ORDER BY id DESC LIMIT 1", params![meeting,target], |r|r.get(0)).optional()?)
    }

    pub fn backup(&self, destination: &Path) -> Result<()> {
        // Immutable raw files and private DB snapshots form one quiescent backup.
        // A caller must hold exclusive access to the library while backing up.
        let open: i64 = self.db.query_row(
            "SELECT count(*) FROM meeting WHERE capture_state='recording'",
            [],
            |r| r.get(0),
        )?;
        if open > 0 {
            bail!("finish or recover active capture before backup");
        }
        for (id, _) in self.list_meetings()? {
            self.verify_artifacts(&id)?;
            self.verify_raw(&id)?;
        }
        crate::artifacts::validate_destination(&self.root, destination)?;
        std::fs::create_dir_all(destination.join("private"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                destination.join("private"),
                std::fs::Permissions::from_mode(0o700),
            )?;
        }
        self.db
            .backup("main", destination.join("meetings.db"), None)?;
        self.profiles
            .backup("main", destination.join("private/profiles.db"), None)?;
        crate::artifacts::copy_tree(&self.root.join("raw"), &destination.join("raw"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes_cache_is_never_imported_or_rewritten() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let cache = directory.path().join(".coxinha");
        std::fs::create_dir(&cache)?;
        std::fs::write(cache.join("index.db"), b"legacy bytes remain unchanged")?;
        let s = Store::open(directory.path().join("meeting-library"))?;
        s.create_meeting("fixture")?;
        assert_eq!(
            std::fs::read(cache.join("index.db"))?,
            b"legacy bytes remain unchanged"
        );
        Ok(())
    }
    #[test]
    fn library_lock_prevents_concurrent_snapshot_writers() -> Result<()> {
        let d = tempfile::tempdir()?;
        let s = Store::open(d.path())?;
        assert!(Store::open(d.path()).is_err());
        drop(s);
        assert!(Store::open(d.path()).is_ok());
        Ok(())
    }
    #[test]
    fn migration_reopens_and_rejects_future_without_resetting() -> Result<()> {
        let d = tempfile::tempdir()?;
        let s = Store::open(d.path())?;
        let id = s.create_meeting("fixture")?;
        drop(s);
        let s = Store::open(d.path())?;
        assert_eq!(s.list_meetings()?[0].0, id);
        s.db.pragma_update(None, "user_version", 99)?;
        drop(s);
        assert!(Store::open(d.path()).is_err());
        let db = Connection::open(d.path().join("meetings.db"))?;
        assert_eq!(
            db.query_row("SELECT count(*) FROM meeting", [], |r| r.get::<_, i64>(0))?,
            1
        );
        Ok(())
    }
    #[test]
    fn migration_failure_rolls_back_schema_version() -> Result<()> {
        let d = tempfile::tempdir()?;
        let p = d.path().join("bad.db");
        assert!(migrate(
            &p,
            "CREATE TABLE retained(id); INVALID SQL;",
            DatabaseKind::Meetings
        )
        .is_err());
        let db = Connection::open(p)?;
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='retained'",
                [],
                |r| r.get::<_, i64>(0)
            )?,
            0
        );
        Ok(())
    }
}
