use super::*;

#[derive(Clone, Copy)]
enum Replacement {
    Headerless,
    ForeignEnvelope,
    Moved,
    Deleted,
}
struct Case {
    dir: tempfile::TempDir,
    storage: Storage,
    note: Note,
    archive: PathBuf,
}

async fn setup(daily: bool, replacement: Replacement) -> Case {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["notes", "daily"] {
        fs::create_dir(dir.path().join(sub)).await.unwrap();
    }
    let storage = Storage::new(
        dir.path().into(),
        Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
    );
    let body = "# Original indexedbody [[Target]] #original\n";
    let note = if daily {
        let n = storage
            .get_or_create_daily_note(Some("2026-10-24"))
            .await
            .unwrap();
        storage.update_note(n.id, body).await.unwrap()
    } else {
        storage.create_note("Original", body).await.unwrap()
    };
    let archive = dir.path().join("notes/archive.md");
    let path = dir.path().join(&note.path);
    if matches!(replacement, Replacement::Deleted) {
        fs::remove_file(&path).await.unwrap();
    } else {
        fs::rename(&path, &archive).await.unwrap();
    }
    match replacement {
        Replacement::Headerless => fs::write(&path, "# Unrelated replacement\n").await.unwrap(),
        Replacement::ForeignEnvelope => fs::write(
            &path,
            NoteFile::new_document(Uuid::new_v4(), "# Foreign note\n"),
        )
        .await
        .unwrap(),
        _ => {}
    }
    Case {
        dir,
        storage,
        note,
        archive,
    }
}

fn sql_rows(conn: &rusqlite::Connection, query: &str) -> Vec<(String, String, String)> {
    conn.prepare(query)
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}
async fn snapshot(c: &Case) -> serde_json::Value {
    let conn = rusqlite::Connection::open(c.dir.path().join("index.db")).unwrap();
    serde_json::json!({
        "notes": c.storage.list_notes().await.unwrap(),
        "fts": sql_rows(&conn, "SELECT id,title,body FROM notes_fts ORDER BY id,title,body"),
        "links": sql_rows(&conn, "SELECT source_id,target_text,target_lc FROM links ORDER BY source_id,target_text,target_lc"),
        "old_bytes": fs::read(c.dir.path().join(&c.note.path)).await.ok(),
        "archive_bytes": fs::read(&c.archive).await.ok(),
    })
}
fn code(replacement: Replacement) -> &'static str {
    match replacement {
        Replacement::Headerless => "note_file_changed_externally",
        Replacement::ForeignEnvelope => "note_file_identity_conflict",
        _ => "note_file_missing_or_moved",
    }
}

#[tokio::test]
async fn red_stale_delete_headerless_preserves_bytes_and_index_without_pending_edit() {
    let c = setup(false, Replacement::Headerless).await;
    let before = snapshot(&c).await;
    let result = c.storage.delete_note(c.note.id).await;
    assert_eq!(
        snapshot(&c).await,
        before,
        "stale delete must preserve all bytes/index/FTS/links"
    );
    assert_eq!(
        result.unwrap_err().to_string(),
        code(Replacement::Headerless)
    );
}
#[tokio::test]
async fn red_stale_delete_foreign_envelope_preserves_bytes_and_index() {
    let c = setup(false, Replacement::ForeignEnvelope).await;
    let before = snapshot(&c).await;
    let result = c.storage.delete_note(c.note.id).await;
    assert_eq!(snapshot(&c).await, before);
    assert_eq!(
        result.unwrap_err().to_string(),
        code(Replacement::ForeignEnvelope)
    );
}
#[tokio::test]
async fn red_stale_get_note_does_not_expose_headerless_replacement() {
    let c = setup(false, Replacement::Headerless).await;
    let before = snapshot(&c).await;
    let result = c.storage.get_note(c.note.id).await;
    assert_eq!(snapshot(&c).await, before);
    assert_eq!(
        result.unwrap_err().to_string(),
        code(Replacement::Headerless)
    );
}
#[tokio::test]
async fn red_stale_daily_does_not_expose_replacement_identity() {
    for replacement in [Replacement::Headerless, Replacement::ForeignEnvelope] {
        let c = setup(true, replacement).await;
        let before = snapshot(&c).await;
        let result = c.storage.get_or_create_daily_note(Some("2026-10-24")).await;
        assert_eq!(snapshot(&c).await, before);
        assert_eq!(result.unwrap_err().to_string(), code(replacement));
    }
}
#[tokio::test]
async fn red_missing_or_moved_delete_keeps_indexed_uuid_recoverable() {
    for replacement in [Replacement::Moved, Replacement::Deleted] {
        let c = setup(false, replacement).await;
        let before = snapshot(&c).await;
        let result = c.storage.delete_note(c.note.id).await;
        assert_eq!(snapshot(&c).await, before);
        assert_eq!(result.unwrap_err().to_string(), code(replacement));
    }
}
#[tokio::test]
async fn red_missing_or_moved_reads_and_daily_use_stable_code_without_recreation() {
    for replacement in [Replacement::Moved, Replacement::Deleted] {
        let c = setup(true, replacement).await;
        let before = snapshot(&c).await;
        assert_eq!(
            c.storage.get_note(c.note.id).await.unwrap_err().to_string(),
            code(replacement)
        );
        assert_eq!(
            c.storage
                .get_or_create_daily_note(Some("2026-10-24"))
                .await
                .unwrap_err()
                .to_string(),
            code(replacement)
        );
        assert_eq!(snapshot(&c).await, before);
    }
}

#[tokio::test]
async fn explicit_rebuild_recovers_original_then_update_delete_touch_only_its_archive() {
    for replacement in [
        Replacement::Headerless,
        Replacement::ForeignEnvelope,
        Replacement::Moved,
    ] {
        let c = setup(true, replacement).await;
        let old_bytes = fs::read(c.dir.path().join(&c.note.path)).await.ok();
        c.storage.rebuild_from_vault().await.unwrap();
        let original = c.storage.get_note(c.note.id).await.unwrap();
        assert_eq!(original.note.path, "notes/archive.md");
        if !matches!(replacement, Replacement::Moved) {
            let daily = c
                .storage
                .get_or_create_daily_note(Some("2026-10-24"))
                .await
                .unwrap();
            assert_ne!(daily.id, c.note.id);
            assert_eq!(daily.path, c.note.path);
            assert!(c.storage.get_note(daily.id).await.is_ok());
        }
        c.storage
            .update_note(c.note.id, "# Recovered intended edit")
            .await
            .unwrap();
        assert_eq!(
            c.storage.get_note(c.note.id).await.unwrap().markdown,
            "# Recovered intended edit"
        );
        assert_eq!(
            fs::read(c.dir.path().join(&c.note.path)).await.ok(),
            old_bytes
        );
        c.storage.delete_note(c.note.id).await.unwrap();
        assert!(!c.archive.exists());
        assert_eq!(
            fs::read(c.dir.path().join(&c.note.path)).await.ok(),
            old_bytes
        );
        assert!(c
            .storage
            .search_notes("Recovered")
            .await
            .unwrap()
            .is_empty());
        assert!(c
            .storage
            .list_notes()
            .await
            .unwrap()
            .iter()
            .all(|n| n.id != c.note.id));
    }
}
