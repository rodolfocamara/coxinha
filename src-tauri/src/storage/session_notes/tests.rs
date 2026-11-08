use super::*;
use coxinha_core::store::{session::NewSession, Store};

pub(super) fn fixture(root: &Path) -> (Storage, Store) {
    for sub in ["notes", "daily"] {
        std::fs::create_dir_all(root.join(sub)).unwrap();
    }
    let storage = Storage::new(
        root.into(),
        Arc::new(Db::open(&root.join("index.db")).unwrap()),
    );
    let store = Store::open(root.join("library")).unwrap();
    (storage, store)
}

#[tokio::test]
async fn concurrent_publication_has_one_uuid_file_binding_and_preserves_edited_body() -> Result<()>
{
    let d = tempfile::tempdir()?;
    let (storage, store) = fixture(d.path());
    let session = store.create_session(&NewSession::manual("No audio"))?;
    let intent = store.reserve_personal_note(&session.id)?;
    let permit = storage.mutation_permit().await?;
    let (a, b) = tokio::join!(
        storage.publish_session_note(&intent, &permit),
        storage.publish_session_note(&intent, &permit)
    );
    let a = a?;
    assert_eq!(a, b?);
    store.complete_personal_note(&session.id, &a)?;
    let edited = "# My private edits\nNever replace this body.\n";
    // Drop outer permit before ordinary CRUD: never reenter a permit around exit.
    drop(permit);
    storage.update_note(a.id, edited).await?;
    let permit = storage.mutation_permit().await?;
    let complete = store.personal_note_intent(&session.id)?.unwrap();
    storage.publish_session_note(&complete, &permit).await?;
    assert_eq!(storage.get_note(a.id).await?.markdown, edited);
    assert_eq!(std::fs::read_dir(d.path().join("notes"))?.count(), 1);
    assert_eq!(store.list_sessions()?.len(), 1);
    assert!(store.list_meetings()?.is_empty());
    Ok(())
}

#[tokio::test]
async fn foreign_file_and_tampered_metadata_never_overwrite_or_delete() -> Result<()> {
    let d = tempfile::tempdir()?;
    let (storage, store) = fixture(d.path());
    let s = store.create_session(&NewSession::manual("Conflict"))?;
    let i = store.reserve_personal_note(&s.id)?;
    let target = d.path().join(&i.relative_path);
    let permit = storage.mutation_permit().await?;
    for raw in [
        "# unrelated".to_string(),
        NoteFile::new_document(i.note_id, "foreign with same UUID"),
        reserved_document(&i).replace(&i.token, &Uuid::new_v4().to_string()),
        reserved_document(&i).replace(&digest(&i), "wrong-content-intent"),
    ] {
        std::fs::write(&target, &raw)?;
        assert!(storage.publish_session_note(&i, &permit).await.is_err());
        assert_eq!(std::fs::read_to_string(&target)?, raw);
        assert!(store.session(&s.id)?.unwrap().personal_note.is_none());
    }
    Ok(())
}

#[tokio::test]
async fn stable_move_rebuild_follows_uuid_and_duplicate_or_missing_refuses() -> Result<()> {
    let d = tempfile::tempdir()?;
    let (storage, store) = fixture(d.path());
    let s = store.create_session(&NewSession::manual("Move"))?;
    let i = store.reserve_personal_note(&s.id)?;
    let permit = storage.mutation_permit().await?;
    let note = storage.publish_session_note(&i, &permit).await?;
    store.complete_personal_note(&s.id, &note)?;
    drop(permit);
    let moved = "notes/moved.md";
    fs::rename(d.path().join(&i.relative_path), d.path().join(moved)).await?;
    let complete = store.personal_note_intent(&s.id)?.unwrap();
    let permit = storage.mutation_permit().await?;
    let reference = storage.publish_session_note(&complete, &permit).await?;
    assert_eq!(reference.relative_path, moved);
    store.complete_personal_note(&s.id, &reference)?;
    drop(permit);
    storage.rebuild_from_vault().await?;
    let permit = storage.mutation_permit().await?;
    assert_eq!(
        storage.publish_session_note(&complete, &permit).await?,
        reference
    );
    fs::copy(d.path().join(moved), d.path().join("notes/duplicate.md")).await?;
    // Complete normal reads verify only the indexed owner, as get_note does.
    assert_eq!(
        storage.publish_session_note(&complete, &permit).await?,
        reference
    );
    // Reserved/crash recovery remains a full scan and refuses canonical duplicates.
    let recovery = PersonalNoteIntent {
        state: "reserved".into(),
        ..complete.clone()
    };
    assert!(matches!(
        storage.publish_session_note(&recovery, &permit).await,
        Err(PublicationError::Conflict(_))
    ));
    drop(permit);
    let before = storage.db.list_notes()?;
    assert!(storage.rebuild_from_vault().await.is_err());
    assert_eq!(
        serde_json::to_value(storage.db.list_notes()?)?,
        serde_json::to_value(before)?
    );
    // Losing the index forces complete-note recovery through the same full scan.
    storage.db.replace_note_index(&[])?;
    let permit = storage.mutation_permit().await?;
    assert!(matches!(
        storage.publish_session_note(&complete, &permit).await,
        Err(PublicationError::Conflict(_))
    ));
    assert!(storage.db.list_notes()?.is_empty());
    fs::remove_file(d.path().join("notes/duplicate.md")).await?;
    fs::remove_file(d.path().join(moved)).await?;
    assert!(storage
        .publish_session_note(&complete, &permit)
        .await
        .is_err());
    assert!(!d.path().join(&i.relative_path).exists());
    Ok(())
}

#[tokio::test]
async fn exclusive_publication_refuses_symlink_target() -> Result<()> {
    #[cfg(unix)]
    {
        let d = tempfile::tempdir()?;
        let (storage, store) = fixture(d.path());
        let s = store.create_session(&NewSession::manual("Symlink"))?;
        let i = store.reserve_personal_note(&s.id)?;
        let unrelated = d.path().join("private.md");
        fs::write(&unrelated, "private unchanged").await?;
        std::os::unix::fs::symlink(&unrelated, d.path().join(&i.relative_path))?;
        let permit = storage.mutation_permit().await?;
        assert!(storage.publish_session_note(&i, &permit).await.is_err());
        assert_eq!(fs::read_to_string(unrelated).await?, "private unchanged");
    }
    Ok(())
}

// A child exits without unwinding at each durable boundary. Parent reopens the
// actual DB/files, so recovery is not proved merely by retrying in-memory state.
#[tokio::test]
#[ignore = "subprocess-only disposable crash fixture"]
async fn publication_crash_child() -> Result<()> {
    let root = PathBuf::from(std::env::var("COXINHA_SESSION_CRASH_ROOT")?);
    let stage = std::env::var("COXINHA_SESSION_CRASH_STAGE")?;
    let (storage, store) = fixture(&root);
    let s = store.create_session(&NewSession::manual("Crash fixture"))?;
    let i = store.reserve_personal_note(&s.id)?;
    if stage != "reserved" {
        let permit = storage.mutation_permit().await?;
        // Published/indexed stages exit from failpoints in the real Storage path.
        let note = storage.publish_session_note(&i, &permit).await?;
        if stage == "complete" {
            store.complete_personal_note(&s.id, &note)?;
        }
    }
    std::process::exit(0);
}

#[tokio::test]
async fn restart_recovers_each_durable_boundary_and_never_resets_user_edits() -> Result<()> {
    for stage in ["reserved", "published", "indexed", "complete"] {
        let d = tempfile::tempdir()?;
        let child = std::process::Command::new(std::env::current_exe()?)
            .args([
                "storage::session_notes::tests::publication_crash_child",
                "--ignored",
                "--exact",
                "--nocapture",
            ])
            .env("COXINHA_SESSION_CRASH_ROOT", d.path())
            .env("COXINHA_SESSION_CRASH_STAGE", stage)
            .output()?;
        assert!(
            child.status.success(),
            "{stage}: {}",
            String::from_utf8_lossy(&child.stderr)
        );
        let (storage, store) = fixture(d.path());
        let session = store.list_sessions()?.remove(0);
        let i = store.personal_note_intent(&session.id)?.unwrap();
        if stage != "reserved" {
            // External editor after crash: metadata remains owned, body changes.
            fs::write(
                d.path().join(&i.relative_path),
                reserved_document(&i) + "My recovered edits",
            )
            .await?;
        }
        let permit = storage.mutation_permit().await?;
        let note = storage.publish_session_note(&i, &permit).await?;
        store.complete_personal_note(&session.id, &note)?;
        assert_eq!(note.id, i.note_id);
        if stage != "reserved" {
            assert_eq!(
                storage.get_note(i.note_id).await?.markdown,
                "My recovered edits"
            );
        }
        assert_eq!(std::fs::read_dir(d.path().join("notes"))?.count(), 1);
    }
    Ok(())
}
