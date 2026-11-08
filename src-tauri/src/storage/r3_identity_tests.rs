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

async fn forget_index(dir: &Path, storage: Storage) -> Storage {
    drop(storage);
    fs::remove_file(dir.join("index.db")).await.unwrap();
    Storage::new(
        dir.into(),
        Arc::new(Db::open(&dir.join("index.db")).unwrap()),
    )
}

#[tokio::test]
async fn unchanged_legacy_first_save_and_unchanged_header_removal_remain_supported() {
    let (dir, storage) = fixture().await;
    let body = "---\r\n\r\n# Legacy\r\nexact\r\n";
    let path = dir.path().join("notes/legacy.md");
    fs::write(&path, body).await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let id = note_file::legacy_id("notes/legacy.md");
    storage.update_note(id, body).await.unwrap();
    assert_eq!(
        NoteFile::parse(&fs::read_to_string(&path).await.unwrap())
            .unwrap()
            .id,
        Some(id)
    );
    fs::write(&path, body).await.unwrap();
    storage
        .update_note(id, "# Explicit edit after removing header")
        .await
        .unwrap();
    assert_eq!(
        storage.get_note(id).await.unwrap().markdown,
        "# Explicit edit after removing header"
    );
}

#[tokio::test]
async fn headerless_save_requires_one_available_exact_indexed_body() {
    for mode in ["missing", "duplicated", "unreadable", "different"] {
        let (dir, storage) = fixture().await;
        let note = storage.create_note("Original", "# Body\r\n").await.unwrap();
        let path = dir.path().join(&note.path);
        fs::write(&path, "# Body\r\n").await.unwrap();
        let conn = rusqlite::Connection::open(dir.path().join("index.db")).unwrap();
        match mode {
            "missing" => {
                conn.execute("DELETE FROM notes_fts WHERE id = ?1", [note.id.to_string()])
                    .unwrap();
            }
            "duplicated" => {
                conn.execute(
                    "INSERT INTO notes_fts (id,title,body) VALUES (?1,'duplicate',?2)",
                    rusqlite::params![note.id.to_string(), "# Body\r\n"],
                )
                .unwrap();
            }
            "unreadable" => {
                conn.execute_batch("DROP TABLE notes_fts").unwrap();
            }
            "different" => {
                fs::write(&path, "# Body\n").await.unwrap();
            }
            _ => unreachable!(),
        }
        let raw = fs::read(&path).await.unwrap();
        let error = storage.update_note(note.id, "# Pending").await.unwrap_err();
        assert_eq!(error.to_string(), "note_file_changed_externally", "{mode}");
        assert_eq!(fs::read(&path).await.unwrap(), raw);
        assert_eq!(storage.list_notes().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn replacement_envelope_returns_stable_identity_conflict_without_writing() {
    let (dir, storage) = fixture().await;
    let original = storage.create_note("Original", "# Original").await.unwrap();
    let other = NoteFile::new_document(Uuid::new_v4(), "# Other");
    fs::write(dir.path().join(&original.path), &other)
        .await
        .unwrap();
    let error = storage
        .update_note(original.id, "# Pending")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "note_file_identity_conflict");
    assert_eq!(
        fs::read_to_string(dir.path().join(&original.path))
            .await
            .unwrap(),
        other
    );
}

#[tokio::test]
async fn generation_allocation_reserves_legitimate_prior_ids_before_both_filename_orders() {
    for (old, retained) in [("notes/a.md", "notes/z.md"), ("notes/z.md", "notes/a.md")] {
        let (dir, storage) = fixture().await;
        fs::write(dir.path().join(old), "# Original").await.unwrap();
        storage.rebuild_from_vault().await.unwrap();
        let canonical = note_file::legacy_id(old);
        storage
            .update_note(canonical, "# Original saved")
            .await
            .unwrap();
        fs::rename(dir.path().join(old), dir.path().join("notes/moved.md"))
            .await
            .unwrap();
        fs::write(dir.path().join(old), "# Replacement")
            .await
            .unwrap();
        fs::write(dir.path().join(retained), "# Legitimate prior")
            .await
            .unwrap();
        let prior = Note {
            id: note_file::legacy_id_gen(old, 1),
            title: "Legitimate prior".into(),
            path: retained.into(),
            tags: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        storage
            .db
            .save_note(&prior, "# Legitimate prior", &[])
            .unwrap();
        for _ in 0..2 {
            let stats = storage.rebuild_from_vault().await.unwrap();
            assert_eq!(stats.notes_indexed, 3);
            assert_eq!(stats.notes_skipped, 0);
            assert_eq!(
                storage.get_note(prior.id).await.unwrap().note.path,
                retained
            );
            assert_eq!(
                storage.get_note(canonical).await.unwrap().note.path,
                "notes/moved.md"
            );
            let replacement = storage
                .get_note(note_file::legacy_id_gen(old, 2))
                .await
                .unwrap();
            assert_eq!(replacement.note.path, old);
            assert_eq!(replacement.markdown, "# Replacement");
            assert_eq!(
                fs::read_to_string(dir.path().join(old)).await.unwrap(),
                "# Replacement"
            );
            assert_eq!(
                fs::read_to_string(dir.path().join(retained)).await.unwrap(),
                "# Legitimate prior"
            );
        }
    }
}

#[tokio::test]
async fn multiple_reuse_generations_survive_rebuild_index_loss_and_explicit_save() {
    for (path, archive_prefix) in [("notes/a.md", "z-archive"), ("notes/z.md", "a-archive")] {
        let (dir, mut storage) = fixture().await;
        fs::write(dir.path().join(path), "# Generation 0")
            .await
            .unwrap();
        storage.rebuild_from_vault().await.unwrap();
        for n in 0..4 {
            let id = note_file::legacy_id_gen(path, n);
            let body = format!("# Generation {n}");
            assert_eq!(storage.get_note(id).await.unwrap().markdown, body);
            storage.update_note(id, &body).await.unwrap();
            let archive = format!("notes/{archive_prefix}-{n}.md");
            fs::rename(dir.path().join(path), dir.path().join(&archive))
                .await
                .unwrap();
            let replacement = format!("# Generation {}", n + 1);
            fs::write(dir.path().join(path), &replacement)
                .await
                .unwrap();
            for _ in 0..2 {
                storage.rebuild_from_vault().await.unwrap();
                assert_eq!(storage.get_note(id).await.unwrap().note.path, archive);
                assert_eq!(
                    storage
                        .get_note(note_file::legacy_id_gen(path, n + 1))
                        .await
                        .unwrap()
                        .markdown,
                    replacement
                );
                assert_eq!(
                    fs::read_to_string(dir.path().join(path)).await.unwrap(),
                    replacement
                );
            }
            storage = forget_index(dir.path(), storage).await;
            storage.rebuild_from_vault().await.unwrap();
            assert_eq!(storage.get_note(id).await.unwrap().note.path, archive);
            assert_eq!(
                storage
                    .get_note(note_file::legacy_id_gen(path, n + 1))
                    .await
                    .unwrap()
                    .markdown,
                replacement
            );
            assert_eq!(storage.list_notes().await.unwrap().len(), (n + 2) as usize);
        }
        let id = note_file::legacy_id_gen(path, 4);
        storage
            .update_note(id, "# Final persisted generation")
            .await
            .unwrap();
        let raw = fs::read_to_string(dir.path().join(path)).await.unwrap();
        storage = forget_index(dir.path(), storage).await;
        storage.rebuild_from_vault().await.unwrap();
        assert_eq!(
            storage.get_note(id).await.unwrap().markdown,
            "# Final persisted generation"
        );
        fs::write(dir.path().join("notes/true-copy.md"), &raw)
            .await
            .unwrap();
        assert!(storage
            .rebuild_from_vault()
            .await
            .unwrap_err()
            .to_string()
            .contains("duplicate note UUID"));
        assert_eq!(storage.list_notes().await.unwrap().len(), 5);
        assert_eq!(
            fs::read_to_string(dir.path().join("notes/true-copy.md"))
                .await
                .unwrap(),
            raw
        );
    }
}

#[tokio::test]
async fn moved_envelope_retains_creation_time_by_uuid_without_lending_it_to_replacement() {
    let (dir, storage) = fixture().await;
    let mut note = storage.create_note("Original", "# Original").await.unwrap();
    let created = chrono::DateTime::parse_from_rfc3339("2020-01-02T03:04:05Z")
        .unwrap()
        .with_timezone(&Utc);
    storage.db.delete_note(note.id).unwrap();
    note.created_at = created;
    storage.db.save_note(&note, "# Original", &[]).unwrap();
    fs::rename(
        dir.path().join(&note.path),
        dir.path().join("notes/moved.md"),
    )
    .await
    .unwrap();
    fs::write(dir.path().join(&note.path), "# Replacement")
        .await
        .unwrap();
    for _ in 0..2 {
        storage.rebuild_from_vault().await.unwrap();
        assert_eq!(
            storage.get_note(note.id).await.unwrap().note.created_at,
            created
        );
        let replacement = storage
            .get_note(note_file::legacy_id(&note.path))
            .await
            .unwrap();
        assert_ne!(replacement.note.created_at, created);
        assert_eq!(replacement.markdown, "# Replacement");
    }
}
