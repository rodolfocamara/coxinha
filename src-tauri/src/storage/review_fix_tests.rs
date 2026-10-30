use super::*;

async fn fixture() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["notes", "daily"] {
        fs::create_dir(dir.path().join(sub)).await.unwrap();
    }
    let db = Arc::new(Db::open(&dir.path().join("index.db")).unwrap());
    let storage = Storage::new(dir.path().into(), db);
    (dir, storage)
}

#[tokio::test]
async fn renamed_envelope_claims_uuid_before_legacy_path_reuse_in_both_scan_orders() {
    for (old_path, moved_path) in [("notes/a.md", "notes/z.md"), ("notes/z.md", "notes/a.md")] {
        let (dir, storage) = fixture().await;
        let original = storage
            .create_note("Original", "# Original durablebody")
            .await
            .unwrap();
        fs::rename(dir.path().join(&original.path), dir.path().join(old_path))
            .await
            .unwrap();
        storage.rebuild_from_vault().await.unwrap();
        let original_bytes = fs::read(dir.path().join(old_path)).await.unwrap();
        fs::rename(dir.path().join(old_path), dir.path().join(moved_path))
            .await
            .unwrap();
        let replacement = "---\n\n# Replacement legacybody\n";
        fs::write(dir.path().join(old_path), replacement)
            .await
            .unwrap();
        let legacy = note_file::legacy_id(old_path);
        assert_ne!(legacy, original.id);
        for _ in 0..2 {
            let stats = storage.rebuild_from_vault().await.unwrap();
            assert_eq!(stats.notes_indexed, 2);
            assert_eq!(stats.notes_skipped, 0);
            let moved = storage.get_note(original.id).await.unwrap();
            assert_eq!(moved.note.path, moved_path);
            assert_eq!(moved.markdown, "# Original durablebody");
            let new_legacy = storage.get_note(legacy).await.unwrap();
            assert_eq!(new_legacy.note.path, old_path);
            assert_eq!(new_legacy.markdown, replacement);
            assert_eq!(
                storage.search_notes("durablebody").await.unwrap()[0].id,
                original.id
            );
            assert_eq!(
                storage.search_notes("legacybody").await.unwrap()[0].id,
                legacy
            );
            assert_eq!(
                fs::read(dir.path().join(moved_path)).await.unwrap(),
                original_bytes
            );
            assert_eq!(
                fs::read_to_string(dir.path().join(old_path)).await.unwrap(),
                replacement
            );
        }
    }
}

#[tokio::test]
async fn true_envelope_duplicates_still_fail_atomically_in_both_scan_orders() {
    for (original_path, copy_path) in [("notes/a.md", "notes/z.md"), ("notes/z.md", "notes/a.md")] {
        let (dir, storage) = fixture().await;
        let target = storage.create_note("Target", "# Target").await.unwrap();
        let original = storage
            .create_note("Original", "# Original durablebody [[Target]]")
            .await
            .unwrap();
        fs::rename(
            dir.path().join(&original.path),
            dir.path().join(original_path),
        )
        .await
        .unwrap();
        storage.rebuild_from_vault().await.unwrap();
        let duplicate = NoteFile::new_document(original.id, "# Different unsafemerge");
        fs::write(dir.path().join(copy_path), &duplicate)
            .await
            .unwrap();
        fs::write(dir.path().join("notes/legacy.md"), "# Legacy unindexed")
            .await
            .unwrap();
        for _ in 0..2 {
            let error = storage.rebuild_from_vault().await.unwrap_err();
            assert!(error.to_string().contains("duplicate note UUID"));
            assert_eq!(storage.list_notes().await.unwrap().len(), 2);
            assert_eq!(
                storage.get_note(original.id).await.unwrap().note.path,
                original_path
            );
            assert_eq!(
                storage.search_notes("durablebody").await.unwrap()[0].id,
                original.id
            );
            assert!(storage
                .search_notes("unsafemerge")
                .await
                .unwrap()
                .is_empty());
            assert!(storage.search_notes("unindexed").await.unwrap().is_empty());
            assert_eq!(
                storage.backlinks(target.id).await.unwrap()[0].id,
                original.id
            );
            assert_eq!(
                fs::read_to_string(dir.path().join(copy_path))
                    .await
                    .unwrap(),
                duplicate
            );
        }
    }
}

#[tokio::test]
async fn missing_or_moved_file_save_returns_stable_error_and_never_recreates_old_path() {
    for moved in [false, true] {
        let (dir, storage) = fixture().await;
        let note = storage
            .create_note("Original", "# Original durablebody")
            .await
            .unwrap();
        let path = dir.path().join(&note.path);
        let moved_path = dir.path().join("notes/moved.md");
        if moved {
            fs::rename(&path, &moved_path).await.unwrap();
        } else {
            fs::remove_file(&path).await.unwrap();
        }
        for _ in 0..2 {
            let error = storage
                .update_note(note.id, "# Retained unsaved")
                .await
                .unwrap_err();
            assert_eq!(error.to_string(), "note_file_missing_or_moved");
            assert!(!path.exists());
            assert!(!path
                .with_file_name(format!(
                    "{}.coxinha-tmp",
                    path.file_name().unwrap().to_str().unwrap()
                ))
                .exists());
            assert_eq!(
                storage.search_notes("durablebody").await.unwrap()[0].id,
                note.id
            );
            assert!(storage.search_notes("unsaved").await.unwrap().is_empty());
        }
        if moved {
            storage.rebuild_from_vault().await.unwrap();
            assert_eq!(
                storage.get_note(note.id).await.unwrap().note.path,
                "notes/moved.md"
            );
            storage
                .update_note(note.id, "# Retained unsaved")
                .await
                .unwrap();
            assert_eq!(
                storage.get_note(note.id).await.unwrap().markdown,
                "# Retained unsaved"
            );
            assert_eq!(storage.list_notes().await.unwrap().len(), 1);
            assert!(!path.exists());
        }
    }
}

#[tokio::test]
async fn fallback_matching_a_real_envelope_uuid_gets_a_distinct_legacy_generation() {
    let (dir, storage) = fixture().await;
    let old_path = dir.path().join("notes/legacy.md");
    let moved_path = dir.path().join("notes/moved.md");
    fs::write(&old_path, "# Original").await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let id = note_file::legacy_id("notes/legacy.md");
    storage.update_note(id, "# Original").await.unwrap();
    let envelope = fs::read(&old_path).await.unwrap();
    fs::rename(&old_path, &moved_path).await.unwrap();
    fs::write(&old_path, "# Replacement").await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(storage.list_notes().await.unwrap().len(), 2);
    assert_eq!(
        storage.get_note(id).await.unwrap().note.path,
        "notes/moved.md"
    );
    let replacement = storage.search_notes("Replacement").await.unwrap();
    assert_eq!(replacement.len(), 1);
    assert_eq!(
        replacement[0].id,
        note_file::legacy_id_gen("notes/legacy.md", 1)
    );
    assert_ne!(replacement[0].id, id);
    assert_eq!(fs::read(&moved_path).await.unwrap(), envelope);
    assert_eq!(
        fs::read_to_string(&old_path).await.unwrap(),
        "# Replacement"
    );
}
