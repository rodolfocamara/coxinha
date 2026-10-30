//! Daily import must share rebuild's complete, read-only identity allocation.
use super::*;

const DATE: &str = "2026-10-24";
const DAILY: &str = "daily/2026-10-24.md";
const ARCHIVE: &str = "notes/archive.md";

async fn fixture() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["notes", "daily"] {
        fs::create_dir(dir.path().join(sub)).await.unwrap();
    }
    let storage = reopen(dir.path(), "index.db");
    (dir, storage)
}

fn reopen(dir: &Path, name: &str) -> Storage {
    Storage::new(dir.into(), Arc::new(Db::open(&dir.join(name)).unwrap()))
}

async fn archive_daily(dir: &Path, storage: &Storage) -> Uuid {
    fs::write(dir.join(DAILY), "# Original\n").await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let id = note_file::legacy_id(DAILY);
    storage
        .update_note(id, "# Archived [[Target]]\n")
        .await
        .unwrap();
    fs::rename(dir.join(DAILY), dir.join(ARCHIVE))
        .await
        .unwrap();
    storage.rebuild_from_vault().await.unwrap();
    fs::write(dir.join(DAILY), "# Replacement\r\n")
        .await
        .unwrap();
    id
}

async fn import_save_recover(dir: &Path, storage: Storage, archive_id: Uuid) {
    let archive_bytes = fs::read(dir.join(ARCHIVE)).await.unwrap();
    let body = fs::read_to_string(dir.join(DAILY)).await.unwrap();
    let before_count = storage.list_notes().await.unwrap().len();
    let expected_total =
        before_count + 1 + usize::from(storage.db.get_note(archive_id).unwrap().is_none());
    let daily = storage.get_or_create_daily_note(Some(DATE)).await.unwrap();
    assert_eq!(daily.id, note_file::legacy_id_gen(DAILY, 1));
    assert_ne!(daily.id, archive_id);
    assert_eq!(storage.list_notes().await.unwrap().len(), before_count + 1);
    assert_eq!(fs::read_to_string(dir.join(DAILY)).await.unwrap(), body);
    assert_eq!(fs::read(dir.join(ARCHIVE)).await.unwrap(), archive_bytes);
    assert_eq!(storage.get_note(daily.id).await.unwrap().markdown, body);
    storage
        .update_note(daily.id, "# Explicit save\n")
        .await
        .unwrap();
    for _ in 0..2 {
        storage.rebuild_from_vault().await.unwrap();
        assert_eq!(
            storage.get_note(archive_id).await.unwrap().note.path,
            ARCHIVE
        );
        assert_eq!(
            storage.get_note(daily.id).await.unwrap().markdown,
            "# Explicit save\n"
        );
    }
    drop(storage);
    fs::remove_file(dir.join("index.db")).await.unwrap();
    let storage = reopen(dir, "index.db");
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(storage.list_notes().await.unwrap().len(), expected_total);
    assert_eq!(
        storage.get_note(archive_id).await.unwrap().note.path,
        ARCHIVE
    );
    assert_eq!(storage.get_note(daily.id).await.unwrap().note.path, DAILY);
    assert_eq!(fs::read(dir.join(ARCHIVE)).await.unwrap(), archive_bytes);
}

#[tokio::test]
async fn red_probe_a_import_reserves_indexed_archived_envelope() {
    let (dir, storage) = fixture().await;
    let id = archive_daily(dir.path(), &storage).await;
    import_save_recover(dir.path(), storage, id).await;
}

#[tokio::test]
async fn red_probe_b_import_reserves_unindexed_envelope_after_index_loss() {
    let (dir, storage) = fixture().await;
    let id = archive_daily(dir.path(), &storage).await;
    drop(storage);
    fs::remove_file(dir.path().join("index.db")).await.unwrap();
    import_save_recover(dir.path(), reopen(dir.path(), "index.db"), id).await;
}

#[tokio::test]
async fn red_partial_index_also_reserves_envelope_missing_from_index() {
    let (dir, storage) = fixture().await;
    let id = archive_daily(dir.path(), &storage).await;
    storage.db.delete_note(id).unwrap();
    storage
        .create_note("Unrelated", "# Unrelated\n")
        .await
        .unwrap();
    import_save_recover(dir.path(), storage, id).await;
}

#[tokio::test]
async fn absent_index_import_allocates_successive_generations_without_global_publication() {
    let (dir, mut storage) = fixture().await;
    let mut archived = Vec::new();
    for n in 0..5 {
        fs::write(dir.path().join(DAILY), format!("# Generation {n}\n"))
            .await
            .unwrap();
        let daily = storage.get_or_create_daily_note(Some(DATE)).await.unwrap();
        assert_eq!(daily.id, note_file::legacy_id_gen(DAILY, n));
        assert_eq!(storage.list_notes().await.unwrap().len(), 1);
        storage
            .update_note(daily.id, &format!("# Saved {n}\n"))
            .await
            .unwrap();
        let archive = format!("notes/archive-{n}.md");
        fs::rename(dir.path().join(DAILY), dir.path().join(&archive))
            .await
            .unwrap();
        archived.push((daily.id, archive));
        drop(storage);
        fs::remove_file(dir.path().join("index.db")).await.unwrap();
        storage = reopen(dir.path(), "index.db");
    }
    for _ in 0..2 {
        storage.rebuild_from_vault().await.unwrap();
        assert_eq!(storage.list_notes().await.unwrap().len(), 5);
        for (id, path) in &archived {
            assert_eq!(storage.get_note(*id).await.unwrap().note.path, *path);
        }
    }
}

#[tokio::test]
async fn daily_import_reserves_legitimate_later_prior_and_publishes_only_requested_row() {
    let (dir, storage) = fixture().await;
    let id = archive_daily(dir.path(), &storage).await;
    let path = "notes/z-retained.md";
    fs::write(dir.path().join(path), "# Retained [[Target]]")
        .await
        .unwrap();
    let prior = Note {
        id: note_file::legacy_id_gen(DAILY, 1),
        title: "Retained".into(),
        path: path.into(),
        tags: vec![],
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    storage
        .db
        .save_note(&prior, "# Retained [[Target]]", &["Target".into()])
        .unwrap();
    fs::write(dir.path().join("notes/unindexed.md"), "# Unindexed")
        .await
        .unwrap();
    let before = index_snapshot(dir.path());
    let daily = storage.get_or_create_daily_note(Some(DATE)).await.unwrap();
    assert_eq!(daily.id, note_file::legacy_id_gen(DAILY, 2));
    assert_eq!(storage.list_notes().await.unwrap().len(), 3);
    storage.db.delete_note(daily.id).unwrap();
    assert_eq!(index_snapshot(dir.path()), before);
    assert_eq!(storage.get_note(id).await.unwrap().note.path, ARCHIVE);
    assert_eq!(storage.get_note(prior.id).await.unwrap().note.path, path);
}

fn index_snapshot(dir: &Path) -> Vec<Vec<Vec<String>>> {
    let conn = rusqlite::Connection::open(dir.join("index.db")).unwrap();
    [
        "SELECT id,path,title,tags_json,created_at,updated_at FROM notes ORDER BY id",
        "SELECT id,title,body FROM notes_fts ORDER BY id,body",
        "SELECT source_id,target_text,target_lc FROM links ORDER BY source_id,target_text",
    ]
    .into_iter()
    .map(|sql| {
        let mut stmt = conn.prepare(sql).unwrap();
        let count = stmt.column_count();
        stmt.query_map([], |row| {
            (0..count).map(|i| row.get::<_, String>(i)).collect()
        })
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap()
    })
    .collect()
}

#[tokio::test]
async fn import_duplicate_and_malformed_preflight_refuse_without_partial_publication() {
    for invalid in ["duplicate", "malformed"] {
        let (dir, storage) = fixture().await;
        let original = storage
            .create_note("Original", "# Original [[Target]]")
            .await
            .unwrap();
        let other = if invalid == "duplicate" {
            NoteFile::new_document(original.id, "# Copy")
        } else {
            "---\ncoxinha-note: 1\nid: [broken\n---\n# Do not lose".into()
        };
        fs::write(dir.path().join("notes/other.md"), &other)
            .await
            .unwrap();
        let daily_body = "# Daily\r\n";
        fs::write(dir.path().join(DAILY), daily_body).await.unwrap();
        let before = index_snapshot(dir.path());
        let original_bytes = fs::read(dir.path().join(&original.path)).await.unwrap();
        let error = storage
            .get_or_create_daily_note(Some(DATE))
            .await
            .unwrap_err();
        // Specific stable IPC classification is exercised separately, without string matching.
        assert!(!error.to_string().is_empty());
        assert_eq!(index_snapshot(dir.path()), before);
        assert_eq!(
            fs::read_to_string(dir.path().join(DAILY)).await.unwrap(),
            daily_body
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("notes/other.md"))
                .await
                .unwrap(),
            other
        );
        assert_eq!(
            fs::read(dir.path().join(&original.path)).await.unwrap(),
            original_bytes
        );
    }
}

#[tokio::test]
async fn ordinary_absent_index_daily_import_is_exact_and_skips_unrelated_invalid_utf8() {
    let (dir, storage) = fixture().await;
    let body = "---\r\n\r\n# Daily\r\n\n```yaml\n---\n```\n";
    fs::write(dir.path().join(DAILY), body).await.unwrap();
    fs::write(dir.path().join("notes/invalid.md"), [0xff])
        .await
        .unwrap();
    let note = storage.get_or_create_daily_note(Some(DATE)).await.unwrap();
    assert_eq!(note.id, note_file::legacy_id(DAILY));
    assert_eq!(storage.get_note(note.id).await.unwrap().markdown, body);
    assert_eq!(
        fs::read_to_string(dir.path().join(DAILY)).await.unwrap(),
        body
    );
    assert_eq!(storage.list_notes().await.unwrap().len(), 1);
    storage.update_note(note.id, body).await.unwrap();
}
