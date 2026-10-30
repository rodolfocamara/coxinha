//! Disposable real-process crash fixture. Never synthesizes or copies a journal.
use super::super::*;
use rusqlite::{types::Value, Connection, OpenFlags};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

const READY: &str = "COXINHA_REAL_HOT_JOURNAL_READY";
const MARKER: &str = ".coxinha-hot-journal-test-only";

pub(super) fn library(captured_v3: bool) -> Result<tempfile::TempDir> {
    let d = tempfile::Builder::new()
        .prefix("coxinha-hot-journal-")
        .tempdir()?;
    std::fs::write(d.path().join(MARKER), b"disposable crash fixture")?;
    if captured_v3 {
        crate::artifacts::copy_tree(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session-v3/library"),
            d.path(),
        )?;
    }
    Ok(d)
}

pub(super) fn seed_probe(path: &Path) -> Result<()> {
    let db = Connection::open(path)?;
    db.execute_batch(
        "CREATE TABLE crash_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO crash_probe VALUES(1,'committed row'),(2,'committed before update');
        CREATE TABLE crash_spill(payload TEXT NOT NULL);",
    )?;
    Ok(())
}

pub(super) fn journal(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}-journal", path.display()))
}

/// Snapshot committed schema and all rows; skip only the intended v4 session table
/// when comparing captured-v3 state to post-upgrade state.
pub(super) fn snapshot(path: &Path, skip_session: bool) -> Result<String> {
    let db = Connection::open(path)?;
    let mut query =
        db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")?;
    let schema = query
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut result = String::new();
    for (kind, name, table, sql) in schema {
        if skip_session && matches!(table.as_str(), "session" | "personal_note_intent") {
            continue;
        }
        result.push_str(&format!("{kind:?} {name:?} {table:?} {sql:?}\n"));
        if kind == "table" {
            let mut query = db.prepare(&format!(
                "SELECT * FROM \"{}\" ORDER BY rowid",
                name.replace('"', "\"\"")
            ))?;
            let count = query.column_count();
            let rows = query
                .query_map([], |r| {
                    (0..count)
                        .map(|i| r.get::<_, Value>(i))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            result.push_str(&format!("{rows:?}\n"));
        }
    }
    Ok(result)
}

pub(super) fn assert_committed_probe(path: &Path) -> Result<()> {
    let db = Connection::open(path)?;
    assert_eq!(
        db.query_row(
            "SELECT group_concat(value,'|') FROM (SELECT value FROM crash_probe ORDER BY id)",
            [],
            |r| r.get::<_, String>(0)
        )?,
        "committed row|committed before update"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM crash_spill", [], |r| r
            .get::<_, i64>(0))?,
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='crash_uncommitted_schema'",
            [],
            |r| r.get::<_, i64>(0)
        )?,
        0
    );
    Ok(())
}

struct KillOnDrop(Child);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub(super) fn crash_writer(root: &Path, file: &str) -> Result<()> {
    let path = root.join(file);
    let before = std::fs::read(&path)?;
    let mut child = KillOnDrop(
        Command::new(std::env::current_exe()?)
            .args([
                "--ignored",
                "--exact",
                "store::session::hot_journal_tests::fixture::crash_writer_child",
                "--nocapture",
            ])
            .env("COXINHA_JOURNAL_TEST_ROOT", root)
            .env("COXINHA_JOURNAL_TEST_FILE", file)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?,
    );
    let stdout = child.0.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if line.is_ok_and(|line| line.contains(READY)) {
                let _ = send.send(());
                break;
            }
        }
    });
    let ready = receive.recv_timeout(Duration::from_secs(15));
    child.0.kill()?;
    let status = child.0.wait()?;
    reader.join().unwrap();
    ready.context("crash writer did not reach its spilled, uncommitted transaction")?;
    assert!(!status.success());
    assert_ne!(
        std::fs::read(&path)?,
        before,
        "SQLite must actually spill uncommitted pages into the database"
    );
    let bytes = std::fs::read(journal(&path))?;
    assert!(bytes.len() > 512 && bytes[..8].iter().any(|b| *b != 0));
    // The actual read-only preflight failure is the hot-journal control. This
    // connection cannot recover anything and leaves the real journal in place.
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let error = db
        .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
        .unwrap_err();
    assert_eq!(error.sqlite_error().unwrap().extended_code, 776, "{error}");
    Ok(())
}

#[test]
#[ignore = "subprocess-only fixture: parent kills this writer before SQLite cleanup"]
fn crash_writer_child() -> Result<()> {
    let root = PathBuf::from(
        std::env::var_os("COXINHA_JOURNAL_TEST_ROOT").context("missing disposable root")?,
    );
    ensure!(
        root.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("coxinha-hot-journal-"),
        "not a disposable test library"
    );
    ensure!(
        std::fs::read(root.join(MARKER))? == b"disposable crash fixture",
        "missing fixture marker"
    );
    let file = std::env::var("COXINHA_JOURNAL_TEST_FILE")?;
    ensure!(
        matches!(file.as_str(), "meetings.db" | "private/profiles.db"),
        "unexpected test database"
    );
    let path = root.join(&file);
    let db = Connection::open(&path)?;
    db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=8; PRAGMA cache_spill=ON; BEGIN IMMEDIATE;
        UPDATE crash_probe SET value='uncommitted replacement' WHERE id=2;
        INSERT INTO crash_probe VALUES(3,'uncommitted insertion');
        CREATE TABLE crash_uncommitted_schema(value TEXT);")?;
    if file == "meetings.db" {
        assert!(db.execute("UPDATE meeting SET title='uncommitted meeting title'", [])? > 0);
    } else {
        assert!(db.execute("UPDATE person SET name='uncommitted private name'", [])? > 0);
        db.execute("UPDATE profile_revision SET revision=revision+100", [])?;
    }
    let payload = "x".repeat(1024);
    for _ in 0..2000 {
        db.execute("INSERT INTO crash_spill VALUES(?1)", [&payload])?;
    }
    assert_eq!(
        db.query_row("SELECT count(*) FROM crash_spill", [], |r| r
            .get::<_, i64>(0))?,
        2000
    );
    assert_eq!(
        db.query_row("SELECT value FROM crash_probe WHERE id=2", [], |r| r
            .get::<_, String>(0))?,
        "uncommitted replacement"
    );
    let bytes = std::fs::read(journal(&path))?;
    assert!(bytes.len() > 512 && bytes[..8].iter().any(|b| *b != 0));
    println!("{READY}");
    std::io::stdout().flush()?;
    // Parent kills the real process while this live connection owns the pending
    // transaction. No rollback, journal copying or simulated journal bytes.
    std::thread::sleep(Duration::from_secs(30));
    anyhow::bail!("parent failed to kill crash writer")
}
