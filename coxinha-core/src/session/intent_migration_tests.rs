use super::*;
use rusqlite::{types::Value, Connection};
use std::collections::BTreeMap;
fn snapshot(path: &std::path::Path) -> Result<BTreeMap<String, Vec<Vec<Value>>>> {
    let db = Connection::open(path)?;
    let mut query=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'personal_note_intent' ORDER BY name")?;
    let tables = query
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut rows = BTreeMap::new();
    for table in tables {
        let mut q = db.prepare(&format!(
            "SELECT * FROM \"{}\" ORDER BY rowid",
            table.replace('"', "\"\"")
        ))?;
        let n = q.column_count();
        let values = q
            .query_map([], |r| {
                (0..n)
                    .map(|i| r.get(i))
                    .collect::<rusqlite::Result<Vec<Value>>>()
            })?
            .collect::<rusqlite::Result<_>>()?;
        rows.insert(table, values);
    }
    Ok(rows)
}
#[test]
fn captured_v4_upgrade_preserves_sessions_jobs_captures_edits_profiles_and_raw() -> Result<()> {
    let d = tempfile::tempdir()?;
    let source =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session-v4/library");
    crate::artifacts::copy_tree(&source, d.path())?;
    let public = d.path().join("meetings.db");
    let private = d.path().join("private/profiles.db");
    assert_eq!(
        Connection::open(&public)?
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        4
    );
    let before = snapshot(&public)?;
    let profiles = super::migration_tests::old_snapshot(&private)?;
    let s = Store::open(d.path())?;
    assert_eq!(
        s.db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        5
    );
    assert_eq!(
        s.profiles
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        4
    );
    assert_eq!(snapshot(&public)?, before);
    assert_eq!(super::migration_tests::old_snapshot(&private)?, profiles);
    assert!(s.pending_personal_notes()?.is_empty());
    let manual = s
        .list_sessions()?
        .into_iter()
        .find(|s| s.meeting_id.is_none())
        .unwrap();
    assert_eq!(manual.title, "Manual v4 title edited by human");
    assert_eq!(
        manual.personal_note.unwrap().relative_path,
        "notes/retained-v4.md"
    );
    // Old references lacking ownership intents are never silently adopted.
    assert!(s.reserve_personal_note(&manual.id).is_err());
    for (meeting, _) in s.list_meetings()? {
        s.verify_raw(&meeting)?;
        s.verify_artifacts(&meeting)?;
    }
    for entry in walkdir(&source.join("raw"))? {
        let rel = entry.strip_prefix(&source)?;
        assert_eq!(std::fs::read(&entry)?, std::fs::read(d.path().join(rel))?);
    }
    drop(s);
    drop(Store::open(d.path())?);
    assert_eq!(snapshot(&public)?, before);
    Ok(())
}
fn walkdir(root: &std::path::Path) -> Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let p = entry?.path();
        if p.is_dir() {
            files.extend(walkdir(&p)?);
        } else {
            files.push(p);
        }
    }
    Ok(files)
}
