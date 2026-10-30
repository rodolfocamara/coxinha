use super::*;
use rusqlite::{types::Value, Connection};
use std::{collections::BTreeMap, path::Path};

fn fixture(root: &Path) -> Result<()> {
    crate::artifacts::copy_tree(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session-v3/library"),
        root,
    )
}

#[derive(Debug, PartialEq)]
pub(super) struct OldSnapshot {
    schema: Vec<(String, String, String, Option<String>)>,
    rows: BTreeMap<String, Vec<Vec<Value>>>,
}
pub(super) fn old_snapshot(path: &Path) -> Result<OldSnapshot> {
    let db = Connection::open(path)?;
    let mut q = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name NOT IN ('session','personal_note_intent','processing_publication') ORDER BY type,name")?;
    let schema: Vec<(String, String, String, Option<String>)> = q
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut rows = BTreeMap::new();
    for (kind, name, _, _) in &schema {
        if kind != "table" {
            continue;
        }
        let mut q = db.prepare(&format!(
            "SELECT * FROM \"{}\" ORDER BY rowid",
            name.replace('"', "\"\"")
        ))?;
        let columns = q.column_count();
        let values = q
            .query_map([], |r| {
                (0..columns)
                    .map(|i| r.get(i))
                    .collect::<rusqlite::Result<Vec<Value>>>()
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.insert(name.clone(), values);
    }
    Ok(OldSnapshot { schema, rows })
}
fn file_bytes(root: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    fn walk(root: &Path, dir: &Path, files: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.is_dir() {
                walk(root, &path, files)?;
            } else {
                files.insert(
                    path.strip_prefix(root)?.to_str().unwrap().into(),
                    std::fs::read(path)?,
                );
            }
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    walk(root, root, &mut result)?;
    Ok(result)
}
fn version(path: &Path) -> Result<u32> {
    Ok(Connection::open(path)?.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

#[test]
fn captured_v3_upgrade_preserves_all_old_rows_schemas_and_raw_files() -> Result<()> {
    let d = tempfile::tempdir()?;
    let root = d.path().join("library");
    fixture(&root)?;
    std::fs::create_dir(d.path().join("notes"))?;
    let markdown =
        b"---\ncoxinha-note: 1\nid: 018f3b5a-0000-7000-8000-000000000000\n---\nHuman body\r\n";
    std::fs::write(d.path().join("notes/personal.md"), markdown)?;
    let board = b"{\"version\":1,\"items\":[{\"noteId\":\"old\",\"x\":33,\"y\":71}]}";
    std::fs::write(d.path().join("board.json"), board)?;
    assert_eq!(version(&root.join("meetings.db"))?, 3);
    assert_eq!(version(&root.join("private/profiles.db"))?, 3);
    let public = old_snapshot(&root.join("meetings.db"))?;
    let private = old_snapshot(&root.join("private/profiles.db"))?;
    for table in ["meeting", "job", "artifact", "human_edit"] {
        assert!(!public.rows[table].is_empty(), "{table}");
    }
    for table in ["person", "assignment", "assignment_event"] {
        assert!(!private.rows[table].is_empty(), "{table}");
    }
    let raw = file_bytes(&root.join("raw"))?;
    assert!(raw.len() >= 5);
    let s = Store::open(&root)?;
    let sessions = s.list_sessions()?;
    assert_eq!(sessions.len(), 2);
    for (id, title) in s.list_meetings()? {
        let session = s.session_for_meeting(&id)?.unwrap();
        assert_eq!(session.id, id);
        assert_eq!(session.title, title);
        assert_eq!(session.origin, SessionOrigin::Recording);
        assert_eq!(session.status, SessionStatus::Planned);
        assert!(session.starts_at.is_none() && session.ends_at.is_none());
        assert!(session.personal_note.is_none());
        let created: String =
            s.db.query_row("SELECT created_at FROM meeting WHERE id=?1", [&id], |r| {
                r.get(0)
            })?;
        assert_eq!(session.created_at, created);
        s.verify_raw(&id)?;
        s.verify_artifacts(&id)?;
    }
    drop(s);
    for _ in 0..3 {
        let s = Store::open(&root)?;
        assert_eq!(s.list_sessions()?, sessions);
    }
    assert_eq!(version(&root.join("meetings.db"))?, 5);
    assert_eq!(version(&root.join("private/profiles.db"))?, 4);
    assert_eq!(old_snapshot(&root.join("meetings.db"))?, public);
    assert_eq!(old_snapshot(&root.join("private/profiles.db"))?, private);
    assert_eq!(file_bytes(&root.join("raw"))?, raw);
    assert_eq!(std::fs::read(d.path().join("notes/personal.md"))?, markdown);
    assert_eq!(std::fs::read(d.path().join("board.json"))?, board);
    Ok(())
}

#[test]
fn captured_fixture_backup_restores_sessions_references_and_existing_data() -> Result<()> {
    let d = tempfile::tempdir()?;
    let root = d.path().join("source");
    fixture(&root)?;
    let s = Store::open(&root)?;
    let manual = s.create_session(&NewSession::manual("No audio"))?;
    let note = PersonalNoteRef {
        id: Uuid::new_v4(),
        relative_path: "daily/2026-10-24.md".into(),
    };
    s.bind_session_note(&manual.id, &note)?;
    let before = s.list_sessions()?;
    let public = old_snapshot(&root.join("meetings.db"))?;
    let private = old_snapshot(&root.join("private/profiles.db"))?;
    let backup = d.path().join("backup");
    s.backup(&backup)?;
    let restored = Store::open(&backup)?;
    assert_eq!(restored.list_sessions()?, before);
    assert_eq!(
        restored.session(&manual.id)?.unwrap().personal_note,
        Some(note)
    );
    assert_eq!(old_snapshot(&backup.join("meetings.db"))?, public);
    assert_eq!(old_snapshot(&backup.join("private/profiles.db"))?, private);
    assert_eq!(
        file_bytes(&root.join("raw"))?,
        file_bytes(&backup.join("raw"))?
    );
    assert!(
        !backup.join("daily").exists(),
        "library backup stores references, not vault Markdown"
    );
    Ok(())
}

#[test]
fn failed_backfill_rolls_back_schema_rows_and_version() -> Result<()> {
    let d = tempfile::tempdir()?;
    fixture(d.path())?;
    let path = d.path().join("meetings.db");
    let db = Connection::open(&path)?;
    // Real v3 schema allowed whitespace titles. Fail after earlier backfill rows.
    db.execute(
        "INSERT INTO meeting(id,title) VALUES('fixture-invalid-title',' ')",
        [],
    )?;
    drop(db);
    let before = old_snapshot(&path)?;
    assert!(Store::open(d.path()).is_err());
    assert_eq!(version(&path)?, 3);
    assert_eq!(old_snapshot(&path)?, before);
    let db = Connection::open(&path)?;
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE tbl_name='session'",
            [],
            |r| r.get::<_, i64>(0)
        )?,
        0
    );
    db.execute(
        "UPDATE meeting SET title='Repaired fixture' WHERE id='fixture-invalid-title'",
        [],
    )?;
    drop(db);
    let s = Store::open(d.path())?;
    assert_eq!(s.list_sessions()?.len(), 3);
    Ok(())
}

#[test]
fn partial_schema_fails_closed_then_clean_retry_migrates_once() -> Result<()> {
    let d = tempfile::tempdir()?;
    fixture(d.path())?;
    let path = d.path().join("meetings.db");
    let db = Connection::open(&path)?;
    db.execute_batch("CREATE TABLE session(unrecognized TEXT); INSERT INTO session VALUES('retain partial state');")?;
    drop(db);
    assert!(Store::open(d.path()).is_err());
    assert_eq!(version(&path)?, 3);
    let db = Connection::open(&path)?;
    assert_eq!(
        db.query_row("SELECT unrecognized FROM session", [], |r| r
            .get::<_, String>(0))?,
        "retain partial state"
    );
    db.execute_batch("DROP TABLE session;")?;
    drop(db);
    let s = Store::open(d.path())?;
    assert_eq!(s.list_sessions()?.len(), 2);
    drop(s);
    assert_eq!(Store::open(d.path())?.list_sessions()?.len(), 2);
    Ok(())
}

#[test]
fn future_versions_in_either_database_refuse_before_other_database_migrates() -> Result<()> {
    for (file, future) in [("meetings.db", 6), ("private/profiles.db", 5)] {
        let d = tempfile::tempdir()?;
        fixture(d.path())?;
        let db = Connection::open(d.path().join(file))?;
        db.pragma_update(None, "user_version", future)?;
        drop(db);
        let before = file_bytes(d.path())?;
        let error = Store::open(d.path()).err().unwrap().to_string();
        assert!(error.contains("newer than supported"), "{error}");
        assert_eq!(version(&d.path().join(file))?, future);
        assert_eq!(
            version(&d.path().join("meetings.db"))?,
            if file == "meetings.db" { future } else { 3 }
        );
        for (name, bytes) in before {
            assert_eq!(std::fs::read(d.path().join(name))?, bytes);
        }
    }
    Ok(())
}

#[test]
fn database_kind_controls_versions_independently_of_filename() -> Result<()> {
    let d = tempfile::tempdir()?;
    let public = d.path().join("unusual-public-name");
    let private = d.path().join("unusual-private-name");
    let db = crate::store::migrate(
        &public,
        include_str!("../schema.sql"),
        crate::store::DatabaseKind::Meetings,
    )?;
    let profiles = crate::store::migrate(
        &private,
        include_str!("../profiles.sql"),
        crate::store::DatabaseKind::Profiles,
    )?;
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        5
    );
    assert_eq!(
        profiles.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        4
    );
    assert!(db.prepare("SELECT * FROM processing_run").is_ok());
    assert!(profiles
        .prepare("SELECT * FROM participant_context")
        .is_ok());
    assert!(profiles.prepare("SELECT * FROM session").is_err());
    Ok(())
}

#[test]
fn captured_fixture_bytes_and_old_schema_sources_match_provenance() -> Result<()> {
    use sha2::{Digest, Sha256};
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session-v3");
    let provenance: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("provenance.json"))?)?;
    for (name, expected) in provenance["fixture_files"].as_object().unwrap() {
        let bytes = std::fs::read(root.join(name))?;
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            expected.as_str().unwrap(),
            "{name}"
        );
    }
    for (name, expected) in provenance["source_files"].as_object().unwrap() {
        if let Some(relative) = name.strip_prefix("coxinha-core/") {
            let path = root.join("captured-source").join(relative);
            if path.exists() {
                assert_eq!(
                    format!("{:x}", Sha256::digest(std::fs::read(path)?)),
                    expected.as_str().unwrap(),
                    "{name}"
                );
            }
        }
    }
    Ok(())
}
