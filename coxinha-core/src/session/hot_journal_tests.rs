use super::*;
use rusqlite::Connection;

#[path = "journal_fixture.rs"]
mod fixture;
use fixture::{assert_committed_probe, crash_writer, journal, library, seed_probe, snapshot};

#[test]
fn real_hot_journal_on_meetings_v4_recovers_committed_content() -> Result<()> {
    let d = library(false)?;
    let s = Store::open(d.path())?;
    let meeting = s.create_meeting("Committed meeting")?;
    let sessions = s.list_sessions()?;
    drop(s);
    let path = d.path().join("meetings.db");
    seed_probe(&path)?;
    let committed = snapshot(&path, false)?;
    crash_writer(d.path(), "meetings.db")?;
    let s = Store::open(d.path()).context("recover real v4 meetings hot journal")?;
    assert_eq!(
        s.list_meetings()?,
        vec![(meeting, "Committed meeting".into())]
    );
    assert_eq!(s.list_sessions()?, sessions);
    assert_eq!(snapshot(&path, false)?, committed);
    assert_committed_probe(&path)?;
    assert!(!journal(&path).exists());
    drop(s);
    drop(Store::open(d.path())?);
    assert_eq!(snapshot(&path, false)?, committed);
    Ok(())
}

#[test]
fn real_hot_journal_on_profiles_v3_recovers_committed_content() -> Result<()> {
    let d = library(false)?;
    let s = Store::open(d.path())?;
    s.create_person("Committed private profile", &[], "disposable fixture")?;
    drop(s);
    let path = d.path().join("private/profiles.db");
    seed_probe(&path)?;
    let committed = snapshot(&path, false)?;
    crash_writer(d.path(), "private/profiles.db")?;
    let s = Store::open(d.path()).context("recover real v3 profiles hot journal")?;
    assert_eq!(
        s.profiles
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        4
    );
    assert_eq!(snapshot(&path, false)?, committed);
    assert_committed_probe(&path)?;
    assert!(!journal(&path).exists());
    drop(s);
    drop(Store::open(d.path())?);
    assert_eq!(snapshot(&path, false)?, committed);
    Ok(())
}

#[test]
fn real_hot_journal_on_captured_v3_recovers_before_v4_upgrade() -> Result<()> {
    let d = library(true)?;
    let path = d.path().join("meetings.db");
    seed_probe(&path)?;
    let committed = snapshot(&path, false)?;
    let private = super::migration_tests::old_snapshot(&d.path().join("private/profiles.db"))?;
    crash_writer(d.path(), "meetings.db")?;
    let s = Store::open(d.path()).context("recover real v3 hot journal before upgrade")?;
    assert_eq!(
        s.db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        5
    );
    assert_eq!(snapshot(&path, true)?, committed);
    assert_committed_probe(&path)?;
    assert!(!journal(&path).exists());
    let sessions = s.list_sessions()?;
    assert_eq!(sessions.len(), 2);
    for (id, title) in s.list_meetings()? {
        let session = s.session_for_meeting(&id)?.unwrap();
        assert_eq!(session.title, title);
        assert_eq!(session.id, id);
        assert_ne!(title, "uncommitted meeting title");
    }
    drop(s);
    assert_eq!(Store::open(d.path())?.list_sessions()?, sessions);
    assert_eq!(snapshot(&path, true)?, committed);
    assert_eq!(
        super::migration_tests::old_snapshot(&d.path().join("private/profiles.db"))?,
        private
    );
    Ok(())
}

#[test]
fn recovery_writes_are_allowed_but_other_future_database_blocks_schema_upgrade() -> Result<()> {
    let d = library(true)?;
    let path = d.path().join("meetings.db");
    seed_probe(&path)?;
    let committed = snapshot(&path, false)?;
    let private = d.path().join("private/profiles.db");
    Connection::open(&private)?.pragma_update(None, "user_version", 5)?;
    let private_bytes = std::fs::read(&private)?;
    crash_writer(d.path(), "meetings.db")?;
    let crashed_bytes = std::fs::read(&path)?;
    let error = Store::open(d.path())
        .err()
        .context("future profiles should refuse open")?;
    assert!(
        error.to_string().contains("newer than supported"),
        "{error:#}"
    );
    assert!(
        !journal(&path).exists(),
        "earlier meetings preflight recovered its journal"
    );
    assert_ne!(
        std::fs::read(&path)?,
        crashed_bytes,
        "recovery writes are permitted"
    );
    assert_eq!(
        snapshot(&path, false)?,
        committed,
        "no v4 session schema or changed committed rows"
    );
    assert_committed_probe(&path)?;
    let db = Connection::open(&path)?;
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        3
    );
    assert!(db.prepare("SELECT * FROM session").is_err());
    assert_eq!(std::fs::read(&private)?, private_bytes);
    assert!(Store::open(d.path()).is_err());
    assert_eq!(snapshot(&path, false)?, committed);
    Ok(())
}

#[test]
fn earlier_future_version_refusal_leaves_later_hot_profiles_untouched() -> Result<()> {
    let d = library(true)?;
    let public = d.path().join("meetings.db");
    Connection::open(&public)?.pragma_update(None, "user_version", 6)?;
    let public_bytes = std::fs::read(&public)?;
    let path = d.path().join("private/profiles.db");
    seed_probe(&path)?;
    let committed = snapshot(&path, false)?;
    crash_writer(d.path(), "private/profiles.db")?;
    let crashed_bytes = std::fs::read(&path)?;
    let journal_bytes = std::fs::read(journal(&path))?;
    let error = Store::open(d.path())
        .err()
        .context("future meetings should refuse open")?;
    assert!(
        error.to_string().contains("newer than supported"),
        "{error:#}"
    );
    assert_eq!(std::fs::read(&public)?, public_bytes);
    assert_eq!(std::fs::read(&path)?, crashed_bytes);
    assert_eq!(
        std::fs::read(journal(&path))?,
        journal_bytes,
        "profiles preflight was never reached"
    );
    // Explicit test-only recovery after proving Store did not touch the later DB.
    assert_eq!(snapshot(&path, false)?, committed);
    assert_committed_probe(&path)?;
    Ok(())
}

#[test]
fn future_profiles_refusal_does_not_create_missing_meetings_database() -> Result<()> {
    let d = library(false)?;
    std::fs::create_dir(d.path().join("private"))?;
    let path = d.path().join("private/profiles.db");
    Connection::open(&path)?.pragma_update(None, "user_version", 5)?;
    let bytes = std::fs::read(&path)?;
    assert!(Store::open(d.path()).is_err());
    assert!(!d.path().join("meetings.db").exists());
    assert_eq!(std::fs::read(path)?, bytes);
    Ok(())
}
