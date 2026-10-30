use super::*;

async fn fixture() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["notes", "daily"] {
        fs::create_dir(dir.path().join(sub)).await.unwrap();
    }
    let storage = Storage::new(
        dir.path().into(),
        Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
    );
    (dir, storage)
}

#[tokio::test]
async fn get_note_waits_through_an_in_app_filesystem_index_split_before_guarding() {
    let (dir, storage) = fixture().await;
    let path = dir.path().join("notes/legacy.md");
    fs::write(&path, "# Before").await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let note = storage.list_notes().await.unwrap()[0].clone();
    let permit = storage.mutation_permit().await.unwrap();
    let writer = storage.note_writes.lock().await;
    fs::write(&path, "# After").await.unwrap();
    let reading = storage.get_note(note.id);
    tokio::pin!(reading);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(15), &mut reading)
            .await
            .is_err()
    );
    storage.db.save_note(&note, "# After", &[]).unwrap();
    drop(writer);
    drop(permit);
    assert_eq!(reading.await.unwrap().markdown, "# After");
}

#[tokio::test]
async fn unchanged_headerless_reads_daily_update_and_delete_still_work_without_reentrant_lock() {
    let (dir, storage) = fixture().await;
    let path = dir.path().join("daily/2026-10-24.md");
    fs::write(&path, "# Legacy daily").await.unwrap();
    let other_path = dir.path().join("notes/unchanged-legacy.md");
    fs::write(&other_path, "# Unchanged legacy").await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let other_id = note_file::legacy_id("notes/unchanged-legacy.md");
    assert_eq!(
        storage.get_note(other_id).await.unwrap().markdown,
        "# Unchanged legacy"
    );
    storage.delete_note(other_id).await.unwrap();
    assert!(!other_path.exists());
    let daily = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        storage.get_or_create_daily_note(Some("2026-10-24")),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        storage.get_note(daily.id).await.unwrap().markdown,
        "# Legacy daily"
    );
    assert_eq!(fs::read_to_string(&path).await.unwrap(), "# Legacy daily");
    storage
        .update_note(daily.id, "# First explicit save")
        .await
        .unwrap();
    assert_eq!(
        NoteFile::parse(&fs::read_to_string(&path).await.unwrap())
            .unwrap()
            .id,
        Some(daily.id)
    );
    storage.delete_note(daily.id).await.unwrap();
    assert!(!path.exists());
    assert!(storage.list_notes().await.unwrap().is_empty());
    storage.delete_note(daily.id).await.unwrap();
    storage.delete_note(Uuid::new_v4()).await.unwrap();
}

#[tokio::test]
async fn same_uuid_external_markdown_is_readable_without_claiming_revision_protection() {
    let (dir, storage) = fixture().await;
    let note = storage
        .get_or_create_daily_note(Some("2026-10-24"))
        .await
        .unwrap();
    fs::write(
        dir.path().join(&note.path),
        NoteFile::new_document(note.id, "# External same-UUID edit"),
    )
    .await
    .unwrap();
    assert_eq!(
        storage.get_note(note.id).await.unwrap().markdown,
        "# External same-UUID edit"
    );
    assert_eq!(
        storage
            .get_or_create_daily_note(Some("2026-10-24"))
            .await
            .unwrap()
            .id,
        note.id
    );
    storage.delete_note(note.id).await.unwrap();
    assert!(!dir.path().join(&note.path).exists());
}

#[tokio::test]
async fn all_indexed_crud_refuses_headerless_file_when_indexed_body_is_unavailable() {
    for corrupt in ["missing", "duplicate", "unreadable"] {
        let (dir, storage) = fixture().await;
        let note = storage
            .get_or_create_daily_note(Some("2026-10-24"))
            .await
            .unwrap();
        let body = storage.get_note(note.id).await.unwrap().markdown;
        let path = dir.path().join(&note.path);
        fs::write(&path, &body).await.unwrap();
        let conn = rusqlite::Connection::open(dir.path().join("index.db")).unwrap();
        if corrupt == "missing" {
            conn.execute("DELETE FROM notes_fts WHERE id = ?1", [note.id.to_string()])
                .unwrap();
        } else if corrupt == "unreadable" {
            conn.execute_batch("DROP TABLE notes_fts").unwrap();
        } else {
            conn.execute(
                "INSERT INTO notes_fts (id,title,body) VALUES (?1,'duplicate',?2)",
                rusqlite::params![note.id.to_string(), body],
            )
            .unwrap();
        }
        assert_eq!(
            storage.get_note(note.id).await.unwrap_err().to_string(),
            "note_file_changed_externally"
        );
        assert_eq!(
            storage
                .get_or_create_daily_note(Some("2026-10-24"))
                .await
                .unwrap_err()
                .to_string(),
            "note_file_changed_externally"
        );
        assert_eq!(
            storage.delete_note(note.id).await.unwrap_err().to_string(),
            "note_file_changed_externally"
        );
        assert_eq!(fs::read_to_string(&path).await.unwrap(), body);
        assert_eq!(storage.list_notes().await.unwrap().len(), 1);
    }
}
