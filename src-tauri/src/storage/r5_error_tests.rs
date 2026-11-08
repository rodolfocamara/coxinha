use super::*;
use crate::note_errors::ipc_error;

#[tokio::test]
async fn import_preflight_errors_have_specific_stable_ipc_codes_and_internal_diagnostics() {
    for kind in ["duplicate", "malformed", "nil", "unsupported"] {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).await.unwrap();
        fs::create_dir(dir.path().join("daily")).await.unwrap();
        let storage = Storage::new(
            dir.path().into(),
            Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
        );
        let note = storage.create_note("Original", "# Original").await.unwrap();
        let raw = match kind {
            "duplicate" => NoteFile::new_document(note.id, "# Duplicate"),
            "nil" => NoteFile::new_document(Uuid::nil(), "# Nil"),
            "unsupported" => NoteFile::new_document(Uuid::new_v4(), "# Other").replacen(
                "coxinha-note: 1",
                "coxinha-note: 2",
                1,
            ),
            _ => "---\ncoxinha-note: 1\nid: [broken\n---\n# Unchanged".into(),
        };
        fs::write(dir.path().join("notes/other.md"), &raw)
            .await
            .unwrap();
        fs::write(dir.path().join("daily/2026-10-24.md"), "# Daily")
            .await
            .unwrap();
        let error = storage
            .get_or_create_daily_note(Some("2026-10-24"))
            .await
            .unwrap_err();
        let diagnostic = format!("{error:#}");
        assert!(diagnostic.contains("notes/other.md"), "{diagnostic}");
        assert_eq!(
            ipc_error(error).lines().next().unwrap(),
            if kind == "duplicate" {
                "note_file_identity_conflict"
            } else {
                "note_file_invalid_metadata"
            }
        );
        assert_eq!(storage.list_notes().await.unwrap().len(), 1);
        assert_eq!(
            fs::read_to_string(dir.path().join("notes/other.md"))
                .await
                .unwrap(),
            raw
        );
    }
}

#[tokio::test]
async fn save_note_maps_only_same_uuid_other_path_conflict_and_preserves_sql_failure() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("notes")).await.unwrap();
    let storage = Storage::new(
        dir.path().into(),
        Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
    );
    let original = storage
        .create_note("Original", "# Original [[Target]]")
        .await
        .unwrap();
    let mut other = original.clone();
    other.path = "notes/other.md".into();
    let error = storage.db.save_note(&other, "# Other", &[]).unwrap_err();
    assert!(format!("{error:#}").contains("note UUID already belongs to another path"));
    let message = ipc_error(error);
    assert_eq!(message.lines().next(), Some("note_file_identity_conflict"));
    assert!(message.contains("note UUID already belongs to another path"));
    assert_eq!(
        storage.get_note(original.id).await.unwrap().markdown,
        "# Original [[Target]]"
    );
    let conn = rusqlite::Connection::open(dir.path().join("index.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'injected SQL failure'); END;").unwrap();
    let error = storage
        .db
        .save_note(&original, "# Not published", &[])
        .unwrap_err();
    assert!(ipc_error(error).contains("injected SQL failure"));
    assert_eq!(
        storage.db.indexed_note_body(original.id).unwrap().unwrap(),
        "# Original [[Target]]"
    );
}

#[tokio::test]
async fn requested_invalid_utf8_fails_without_import_or_recreation() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("daily")).await.unwrap();
    let storage = Storage::new(
        dir.path().into(),
        Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
    );
    let path = dir.path().join("daily/2026-10-24.md");
    fs::write(&path, [0xff, 0xfe]).await.unwrap();
    let error = storage
        .get_or_create_daily_note(Some("2026-10-24"))
        .await
        .unwrap_err();
    assert!(error
        .downcast_ref::<io::Error>()
        .is_some_and(|e| e.kind() == io::ErrorKind::InvalidData));
    assert!(storage.list_notes().await.unwrap().is_empty());
    assert_eq!(fs::read(&path).await.unwrap(), [0xff, 0xfe]);
}

#[test]
fn bom_prefix_remains_unmarked_body_under_the_byte_zero_reserved_marker_contract() {
    let raw = format!(
        "\u{feff}{}",
        NoteFile::new_document(Uuid::new_v4(), "# Body\r\n")
    );
    let parsed = NoteFile::parse(&raw).unwrap();
    assert_eq!(parsed.id, None);
    assert_eq!(parsed.body, raw);
}
