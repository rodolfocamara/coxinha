use super::tests::fixture;
use super::*;
use coxinha_core::store::session::NewSession;

#[tokio::test]
async fn complete_read_skips_scan_and_all_index_writes_but_verifies_tamper() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let (storage, store) = fixture(dir.path());
    let session = store.create_session(&NewSession::manual("Fast read"))?;
    let intent = store.reserve_personal_note(&session.id)?;
    let permit = storage.mutation_permit().await?;
    let note = storage.publish_session_note(&intent, &permit).await?;
    store.complete_personal_note(&session.id, &note)?;
    let complete = store.personal_note_intent(&session.id)?.unwrap();
    // Any full scan would fail on this non-directory; normal read must not touch it.
    fs::remove_dir(dir.path().join("daily")).await?;
    fs::write(dir.path().join("daily"), "unrelated file").await?;
    let index = rusqlite::Connection::open(dir.path().join("index.db"))?;
    index.execute_batch("CREATE TRIGGER no_insert BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT,'unexpected index insert'); END;
        CREATE TRIGGER no_update BEFORE UPDATE ON notes BEGIN SELECT RAISE(ABORT,'unexpected index update'); END;
        CREATE TRIGGER no_delete BEFORE DELETE ON notes BEGIN SELECT RAISE(ABORT,'unexpected index delete'); END;")?;
    let raw = fs::read_to_string(dir.path().join(&note.relative_path)).await?;
    let edited = format!("{raw}# Externally edited body\n");
    fs::write(dir.path().join(&note.relative_path), &edited).await?;
    assert_eq!(
        storage.publish_session_note(&complete, &permit).await?,
        note
    );
    assert!(storage
        .get_note(note.id)
        .await?
        .markdown
        .contains("Externally edited body"));
    fs::write(
        dir.path().join(&note.relative_path),
        edited.replace(&intent.token, "foreign-token"),
    )
    .await?;
    assert!(matches!(
        storage.publish_session_note(&complete, &permit).await,
        Err(PublicationError::Conflict(_))
    ));
    Ok(())
}

#[tokio::test]
async fn invalid_moved_path_is_refused_before_index_mutation() -> Result<()> {
    for moved in ["notes/ invalid.md", "notes/ invalid-folder/moved.md"] {
        let dir = tempfile::tempdir()?;
        let (storage, store) = fixture(dir.path());
        let s = store.create_session(&NewSession::manual("Invalid move"))?;
        let intent = store.reserve_personal_note(&s.id)?;
        let permit = storage.mutation_permit().await?;
        let note = storage.publish_session_note(&intent, &permit).await?;
        store.complete_personal_note(&s.id, &note)?;
        let before = serde_json::to_value(storage.db.list_notes()?)?;
        let body_before = storage.db.indexed_note_body(note.id)?;
        fs::create_dir_all(dir.path().join(moved).parent().unwrap()).await?;
        fs::rename(dir.path().join(&note.relative_path), dir.path().join(moved)).await?;
        let complete = store.personal_note_intent(&s.id)?.unwrap();
        assert!(matches!(
            storage.publish_session_note(&complete, &permit).await,
            Err(PublicationError::Conflict(_))
        ));
        assert_eq!(serde_json::to_value(storage.db.list_notes()?)?, before);
        assert_eq!(storage.db.indexed_note_body(note.id)?, body_before);
        assert_eq!(store.session(&s.id)?.unwrap().personal_note, Some(note));
    }
    Ok(())
}

#[test]
fn quoted_ownership_preserves_yaml_strings_and_accepts_old_envelopes() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let (_storage, store) = fixture(dir.path());
    let s = store.create_session(&NewSession::manual("Quoted"))?;
    let mut intent = store.reserve_personal_note(&s.id)?;
    // YAML treats these unquoted scalar spellings as boolean/float, not strings.
    intent.session_id = "true".into();
    intent.token = "123e4567".into();
    let raw = reserved_document(&intent);
    verify_owned_document(&intent, &raw)?;
    let unquoted = raw.replace("coxinha-session: \"true\"", "coxinha-session: true");
    assert!(verify_owned_document(&intent, &unquoted).is_err());
    assert_eq!(
        NoteFile::parse(&raw)?.metadata_string("coxinha-session"),
        Some("true".into())
    );
    let numeric_digest = "1".repeat(64);
    let yaml: serde_yaml::Value =
        serde_yaml::from_str(&format!("digest: {}", quote(&numeric_digest)))?;
    assert_eq!(yaml["digest"].as_str(), Some(numeric_digest.as_str()));
    // Existing ordinary UUID/hex envelopes remain parseable; no legacy broadening.
    let intent = store.personal_note_intent(&s.id)?.unwrap();
    let legacy = format!("---\ncoxinha-note: 1\nid: {}\ncoxinha-session: {}\ncoxinha-intent: {}\ncoxinha-reserved-path: {}\ncoxinha-initial-sha256: {}\n---\n{}", intent.note_id, intent.session_id, intent.token, intent.relative_path, digest(&intent), intent.initial_body);
    verify_owned_document(&intent, &legacy)?;
    assert!(NoteFile::parse("---\nother: true\n---\nlegacy body")?
        .id
        .is_none());
    Ok(())
}
