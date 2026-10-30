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

fn reopen(dir: &Path) -> Storage {
    Storage::new(
        dir.into(),
        Arc::new(Db::open(&dir.join("index.db")).unwrap()),
    )
}

async fn lose_index(dir: &Path, storage: Storage) -> Storage {
    drop(storage);
    fs::remove_file(dir.join("index.db")).await.unwrap();
    reopen(dir)
}

#[tokio::test]
async fn durable_identity_survives_two_rebuilds_missing_index_and_rename() {
    let (dir, storage) = fixture().await;
    let body = "---\r\n\r\n```yaml\r\nid: body-only\r\n```\r\n# Body\r\n";
    let note = storage.create_note("Body", body).await.unwrap();
    for _ in 0..2 {
        storage.rebuild_from_vault().await.unwrap();
        assert_eq!(storage.get_note(note.id).await.unwrap().markdown, body);
    }
    let storage = lose_index(dir.path(), storage).await;
    fs::rename(
        dir.path().join(&note.path),
        dir.path().join("notes/renamed.md"),
    )
    .await
    .unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let fetched = storage.get_note(note.id).await.unwrap();
    assert_eq!(fetched.markdown, body);
    assert_eq!(fetched.note.path, "notes/renamed.md");
}

#[tokio::test]
async fn legacy_prior_id_is_retained_without_rewriting_until_explicit_save() {
    let (dir, storage) = fixture().await;
    let body = "---\nid: ordinary body\n---\n# Legacy\n";
    let path = dir.path().join("notes/legacy.md");
    fs::write(&path, body).await.unwrap();
    let id = Uuid::new_v4();
    let prior = Note {
        id,
        path: "notes/legacy.md".into(),
        title: "Legacy".into(),
        tags: vec![],
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    storage.db.upsert_note(&prior, body).unwrap();
    for _ in 0..2 {
        storage.rebuild_from_vault().await.unwrap();
        assert_eq!(fs::read_to_string(&path).await.unwrap(), body);
        assert_eq!(storage.get_note(id).await.unwrap().markdown, body);
    }
    storage.update_note(id, body).await.unwrap();
    let raw = fs::read_to_string(&path).await.unwrap();
    assert_eq!(NoteFile::parse(&raw).unwrap().id, Some(id));
    assert_eq!(NoteFile::parse(&raw).unwrap().body, body);
    let storage = lose_index(dir.path(), storage).await;
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(storage.list_notes().await.unwrap()[0].id, id);
}

#[tokio::test]
async fn legacy_fallback_is_path_deterministic_with_lost_index_and_never_changes_bytes() {
    let (dir, storage) = fixture().await;
    let path = dir.path().join("notes/legacy.md");
    fs::write(&path, "# Legacy\n").await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let id = storage.list_notes().await.unwrap()[0].id;
    assert_eq!(id, note_file::legacy_id("notes/legacy.md"));
    let storage = lose_index(dir.path(), storage).await;
    fs::write(&path, "# Changed body\n").await.unwrap();
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(storage.list_notes().await.unwrap()[0].id, id);
    assert_eq!(fs::read_to_string(path).await.unwrap(), "# Changed body\n");
}

#[tokio::test]
async fn unknown_nested_metadata_is_verbatim_and_excluded_from_every_index() {
    let (dir, storage) = fixture().await;
    let target = storage.create_note("Target", "# Target").await.unwrap();
    let id = Uuid::new_v4();
    let header = format!("---\r\ncoxinha-note: 1\r\nid: {id}\r\n# retained comment\r\ncustom:\r\n  list: [a, {{b: c}}]\r\n  literal: |\r\n    # HiddenTitle #headertag [[Target]] uniquemetadataword\r\n---\r\n");
    let path = dir.path().join("notes/custom.md");
    fs::write(&path, format!("{header}# Visible\n#bodytag"))
        .await
        .unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let fetched = storage.get_note(id).await.unwrap();
    assert_eq!(fetched.markdown, "# Visible\n#bodytag");
    assert_eq!(fetched.note.title, "Visible");
    assert!(!fetched.note.tags.contains(&"headertag".into()));
    assert!(storage
        .search_notes("uniquemetadataword")
        .await
        .unwrap()
        .is_empty());
    assert!(storage.backlinks(target.id).await.unwrap().is_empty());
    let body = "---\n\n# Edited\n```\n---\n```\n\n";
    storage.update_note(id, body).await.unwrap();
    assert_eq!(
        fs::read_to_string(path).await.unwrap(),
        format!("{header}{body}")
    );
    assert_eq!(storage.get_note(id).await.unwrap().markdown, body);
}

#[tokio::test]
async fn pasted_envelope_cannot_replace_identity_and_duplicate_flow_gets_new_id() {
    let (dir, storage) = fixture().await;
    let original = storage.create_note("Original", "# Original").await.unwrap();
    let pasted = fs::read_to_string(dir.path().join(&original.path))
        .await
        .unwrap();
    storage.update_note(original.id, &pasted).await.unwrap();
    let copied = storage.create_note("Copy", &pasted).await.unwrap();
    assert_ne!(copied.id, original.id);
    // The frontend creates an empty note and then saves get_note's body.
    let duplicate = storage.create_note("", "").await.unwrap();
    storage
        .update_note(
            duplicate.id,
            &storage.get_note(original.id).await.unwrap().markdown,
        )
        .await
        .unwrap();
    for id in [original.id, copied.id, duplicate.id] {
        assert_eq!(storage.get_note(id).await.unwrap().markdown, pasted);
    }
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(storage.list_notes().await.unwrap().len(), 3);
    for note in storage.list_notes().await.unwrap() {
        let raw = fs::read_to_string(dir.path().join(&note.path))
            .await
            .unwrap();
        assert_eq!(NoteFile::parse(&raw).unwrap().id, Some(note.id));
    }
}

#[tokio::test]
async fn duplicate_uuid_files_fail_before_replacing_the_previous_index() {
    let (dir, storage) = fixture().await;
    let note = storage
        .create_note("Original", "# Original uniquebody [[Target]]")
        .await
        .unwrap();
    let raw = fs::read_to_string(dir.path().join(&note.path))
        .await
        .unwrap();
    fs::write(dir.path().join("notes/collision.md"), &raw)
        .await
        .unwrap();
    let error = storage.rebuild_from_vault().await.unwrap_err();
    assert!(error.to_string().contains("duplicate note UUID"));
    assert_eq!(storage.list_notes().await.unwrap().len(), 1);
    assert_eq!(
        storage.search_notes("uniquebody").await.unwrap()[0].id,
        note.id
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("notes/collision.md"))
            .await
            .unwrap(),
        raw
    );
}

#[tokio::test]
async fn malformed_metadata_never_changes_file_or_index_on_read_edit_or_rebuild() {
    let (dir, storage) = fixture().await;
    let note = storage
        .create_note("Original", "# Original oldbody")
        .await
        .unwrap();
    for fields in [
        format!("coxinha-note: 1\nid: {}\nid: {}\n", note.id, note.id),
        format!("coxinha-note: 1\nid: {}\nx: {{a: 1, a: 2}}\n", note.id),
        format!("coxinha-note: 1\nid: {}\nx: [unterminated\n", note.id),
        "coxinha-note: 2\nid: missing\n".into(),
        "coxinha-note: 1\nid: not-a-uuid\n".into(),
        "coxinha-note: 1\nid: 00000000-0000-0000-0000-000000000000\n".into(),
        "coxinha-note: 1\n".into(),
        format!("coxinha-note: 1\nid: {}\nx: {{<<: {{a: 1}}}}\n", note.id),
    ] {
        let bad = format!("---\n{fields}---\n# Never lose this body\n");
        fs::write(dir.path().join(&note.path), &bad).await.unwrap();
        assert!(storage.get_note(note.id).await.is_err());
        assert!(storage.update_note(note.id, "replacement").await.is_err());
        assert!(storage.rebuild_from_vault().await.is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join(&note.path))
                .await
                .unwrap(),
            bad
        );
        assert_eq!(
            storage.search_notes("oldbody").await.unwrap()[0].id,
            note.id
        );
    }
    fs::write(
        dir.path().join(&note.path),
        "---\ncoxinha-note: 1\nid: incomplete",
    )
    .await
    .unwrap();
    assert!(storage.rebuild_from_vault().await.is_err());
}

#[tokio::test]
async fn filesystem_save_failures_leave_original_bytes_and_index_unchanged() {
    let (dir, storage) = fixture().await;
    let note = storage
        .create_note("Original", "# Original oldbody")
        .await
        .unwrap();
    let path = dir.path().join(&note.path);
    let original = fs::read(&path).await.unwrap();
    let tmp = path.with_file_name(format!(
        "{}.coxinha-tmp",
        path.file_name().unwrap().to_str().unwrap()
    ));
    fs::create_dir(&tmp).await.unwrap();
    assert!(storage
        .update_note(note.id, "# Changed newbody")
        .await
        .is_err());
    assert_eq!(fs::read(path).await.unwrap(), original);
    assert_eq!(
        storage.search_notes("oldbody").await.unwrap()[0].id,
        note.id
    );
    assert!(storage.search_notes("newbody").await.unwrap().is_empty());
    fs::create_dir(dir.path().join("daily/2026-10-24.md.coxinha-tmp"))
        .await
        .unwrap();
    assert!(storage
        .get_or_create_daily_note(Some("2026-10-24"))
        .await
        .is_err());
    assert!(!dir.path().join("daily/2026-10-24.md").exists());
}

#[tokio::test]
async fn daily_open_recovers_existing_file_without_overwriting_even_with_lost_index() {
    let (dir, storage) = fixture().await;
    let legacy_path = dir.path().join("daily/2026-10-23.md");
    let body = "# My daily [[Target]] #custom\n";
    fs::write(&legacy_path, body).await.unwrap();
    let legacy = storage
        .get_or_create_daily_note(Some("2026-10-23"))
        .await
        .unwrap();
    assert_eq!(fs::read_to_string(&legacy_path).await.unwrap(), body);
    assert_eq!(storage.get_note(legacy.id).await.unwrap().markdown, body);
    let fresh = storage
        .get_or_create_daily_note(Some("2026-10-24"))
        .await
        .unwrap();
    let storage = lose_index(dir.path(), storage).await;
    let recovered = storage
        .get_or_create_daily_note(Some("2026-10-24"))
        .await
        .unwrap();
    assert_eq!(fresh.id, recovered.id);
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(
        storage
            .get_or_create_daily_note(Some("2026-10-23"))
            .await
            .unwrap()
            .id,
        legacy.id
    );
}

#[test]
fn codec_preserves_every_body_boundary_exactly() {
    let id = Uuid::new_v4();
    for body in [
        "",
        "---",
        "---\n",
        "---\nx: yaml-looking\n---\n# Body",
        "```\n---\n```",
        "\r\n# Body\r\n",
        "---\ncoxinha-note: 999\n---\n",
    ] {
        let raw = NoteFile::new_document(id, body);
        let parsed = NoteFile::parse(&raw).unwrap();
        assert_eq!(parsed.body, body);
        assert_eq!(parsed.id, Some(id));
    }
}

#[tokio::test]
async fn index_save_failure_is_reported_and_rebuild_recovers_same_uuid_from_disk() {
    let (dir, storage) = fixture().await;
    let note = storage
        .create_note("Original", "# Original oldbody")
        .await
        .unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("index.db")).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_save BEFORE INSERT ON notes
        BEGIN SELECT RAISE(ABORT, 'injected index failure'); END;",
    )
    .unwrap();
    assert!(storage
        .update_note(note.id, "# Changed newbody")
        .await
        .is_err());
    assert_eq!(
        storage.search_notes("oldbody").await.unwrap()[0].id,
        note.id
    );
    assert!(storage.search_notes("newbody").await.unwrap().is_empty());
    assert_eq!(
        storage.get_note(note.id).await.unwrap().markdown,
        "# Changed newbody"
    );
    conn.execute_batch("DROP TRIGGER reject_save").unwrap();
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(
        storage.search_notes("newbody").await.unwrap()[0].id,
        note.id
    );
}

#[tokio::test]
async fn changed_external_identity_rejects_stale_editor_save_without_overwriting() {
    let (dir, storage) = fixture().await;
    let note = storage.create_note("Original", "# Original").await.unwrap();
    let new_id = Uuid::new_v4();
    let raw = NoteFile::new_document(new_id, "# External");
    fs::write(dir.path().join(&note.path), &raw).await.unwrap();
    assert!(storage.get_note(note.id).await.is_err());
    assert!(storage.update_note(note.id, "# Stale edit").await.is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join(&note.path))
            .await
            .unwrap(),
        raw
    );
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(
        storage.get_note(new_id).await.unwrap().markdown,
        "# External"
    );
}
