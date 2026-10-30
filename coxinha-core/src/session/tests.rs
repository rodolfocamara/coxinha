use super::*;

#[test]
fn manual_metadata_and_note_reference_survive_restart_without_audio() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let session = s.create_session(&NewSession::manual("Before the meeting"))?;
    assert!(session.meeting_id.is_none());
    assert!(s.list_meetings()?.is_empty());
    assert!(!d.path().join("raw").exists());
    let note = PersonalNoteRef {
        id: Uuid::new_v4(),
        relative_path: "notes/meetings/personal.md".into(),
    };
    s.bind_session_note(&session.id, &note)?;
    s.bind_session_note(&session.id, &note)?;
    let mut input = NewSession::manual("Human title");
    input.starts_at = Some("2026-10-24T15:00:00Z".into());
    input.ends_at = Some("2026-10-24T16:00:00Z".into());
    for status in [
        SessionStatus::Active,
        SessionStatus::Completed,
        SessionStatus::Cancelled,
    ] {
        input.status = status;
        s.update_session(&session.id, &input)?;
    }
    assert_eq!(
        s.db.query_row("SELECT count(*) FROM job", [], |r| r.get::<_, i64>(0))?,
        0
    );
    drop(s);
    let s = Store::open(d.path())?;
    let restored = s.session(&session.id)?.unwrap();
    assert_eq!(restored.title, "Human title");
    assert_eq!(restored.status, SessionStatus::Cancelled);
    assert_eq!(restored.personal_note, Some(note));
    assert_eq!(restored.starts_at, input.starts_at);
    assert_eq!(restored.ends_at, input.ends_at);
    assert_eq!(restored.origin, SessionOrigin::Manual);
    assert_eq!(restored.created_at, session.created_at);
    assert!(restored.meeting_id.is_none());
    assert!(s.session("missing")?.is_none());
    assert!(s.update_session("missing", &input).is_err());
    assert!(!d.path().join("notes").exists());
    Ok(())
}

#[test]
fn automatic_and_manual_first_creation_preserve_canonical_links() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let meeting = s.create_meeting("Imported recording")?;
    let automatic = s.session_for_meeting(&meeting)?.unwrap();
    assert_eq!(automatic.id, meeting);
    assert_eq!(automatic.origin, SessionOrigin::Recording);
    let manual = s.create_session(&NewSession::manual("Preparation"))?;
    assert!(s.attach_meeting(&manual.id, &meeting).is_err());
    let before = s.list_meetings()?;
    assert!(s.create_meeting_for_session("missing", "missing").is_err());
    assert_eq!(s.list_meetings()?, before);
    let recorded = s.create_meeting_for_session(&manual.id, "Capture title")?;
    s.attach_meeting(&manual.id, &recorded)?;
    s.attach_meeting(&manual.id, &recorded)?;
    assert_eq!(
        s.create_meeting_for_session(&manual.id, "Capture title")?,
        recorded
    );
    assert!(s
        .create_meeting_for_session(&manual.id, "Duplicate")
        .is_err());
    assert_eq!(s.list_sessions()?.len(), 2);
    assert_eq!(s.session_for_meeting(&recorded)?.unwrap().id, manual.id);
    assert_eq!(s.session(&manual.id)?.unwrap().title, "Preparation");
    assert!(s.attach_meeting(&manual.id, &meeting).is_err());
    assert!(s.attach_meeting(&manual.id, "missing").is_err());
    assert!(s.attach_meeting("missing", &recorded).is_err());
    drop(s);
    let s = Store::open(d.path())?;
    assert_eq!(s.list_sessions()?.len(), 2);
    assert_eq!(s.list_meetings()?.len(), 2);
    assert_eq!(s.session_for_meeting(&recorded)?.unwrap().id, manual.id);
    assert_eq!(
        s.create_meeting_for_session(&manual.id, "Capture title")?,
        recorded
    );
    Ok(())
}

#[test]
fn attach_unowned_meeting_is_idempotent_and_cannot_steal_links() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    // An unowned canonical row can come from an explicitly controlled repair tool.
    // Normal create_meeting and backfill always create the session themselves.
    let meeting = Uuid::new_v4().to_string();
    s.db.execute(
        "INSERT INTO meeting(id,title) VALUES(?1,'Fixture external row')",
        [&meeting],
    )?;
    let a = s.create_session(&NewSession::manual("A"))?;
    let b = s.create_session(&NewSession::manual("B"))?;
    s.attach_meeting(&a.id, &meeting)?;
    s.attach_meeting(&a.id, &meeting)?;
    assert!(s.attach_meeting(&b.id, &meeting).is_err());
    assert_eq!(s.session_for_meeting(&meeting)?.unwrap().id, a.id);
    assert!(s.session(&b.id)?.unwrap().meeting_id.is_none());
    Ok(())
}

#[test]
fn failed_creation_rolls_back_meeting_session_and_manual_link() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    s.db.execute_batch("CREATE TRIGGER fail_session BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT,'fixture session failure'); END;")?;
    assert!(s.create_meeting("Cannot half-create").is_err());
    assert!(s.list_meetings()?.is_empty());
    assert!(s.list_sessions()?.is_empty());
    s.db.execute_batch("DROP TRIGGER fail_session;")?;
    let session = s.create_session(&NewSession::manual("Manual"))?;
    std::fs::write(d.path().join("raw"), b"filesystem failure")?;
    assert!(s.create_meeting("FS failure").is_err());
    assert!(s
        .create_meeting_for_session(&session.id, "FS failure")
        .is_err());
    assert!(s.list_meetings()?.is_empty());
    assert!(s.session(&session.id)?.unwrap().meeting_id.is_none());
    assert_eq!(s.list_sessions()?.len(), 1);
    Ok(())
}

#[test]
fn failed_commit_rolls_back_both_entities_and_cleans_new_raw_directory() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let manual = s.create_session(&NewSession::manual("Retained manual"))?;
    // Deferred FK failure occurs at commit, after the raw directory was created.
    s.db.execute_batch("CREATE TRIGGER fail_commit AFTER INSERT ON meeting BEGIN INSERT INTO human_edit(meeting_id,target,body) VALUES('missing','fixture','fixture'); END;")?;
    for session in [None, Some(manual.id.as_str())] {
        s.db.pragma_update(None, "defer_foreign_keys", true)?;
        assert!(s
            .create_meeting_in_session("Commit fails", session)
            .is_err());
        assert!(s.list_meetings()?.is_empty());
        assert_eq!(s.list_sessions()?.len(), 1);
        assert!(s.session(&manual.id)?.unwrap().meeting_id.is_none());
        assert_eq!(std::fs::read_dir(d.path().join("raw"))?.count(), 0);
    }
    Ok(())
}

#[test]
fn imported_audio_publishes_session_atomically_and_cleans_failed_import() -> Result<()> {
    let d = tempfile::tempdir()?;
    let source = d.path().join("source.wav");
    let mut wav = hound::WavWriter::create(
        &source,
        hound::WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )?;
    for _ in 0..128 {
        wav.write_sample(0i16)?;
    }
    wav.finalize()?;
    let source_bytes = std::fs::read(&source)?;
    let s = Store::open(d.path().join("library"))?;
    let meeting = s.import_audio("Imported audio", &source)?;
    assert_eq!(
        s.session_for_meeting(&meeting)?.unwrap().title,
        "Imported audio"
    );
    s.verify_raw(&meeting)?;
    s.db.execute_batch("CREATE TRIGGER fail_import_session BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT,'fixture session failure'); END;")?;
    assert!(s.import_audio("Refused import", &source).is_err());
    assert_eq!(s.list_meetings()?.len(), 1);
    assert_eq!(s.list_sessions()?.len(), 1);
    assert_eq!(std::fs::read_dir(s.root.join("raw"))?.count(), 1);
    assert_eq!(std::fs::read(source)?, source_bytes);
    Ok(())
}

#[test]
fn reserved_uuid_creation_is_idempotent_and_preserves_later_links_and_edits() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let id = Uuid::new_v4();
    let input = NewSession::manual("Retryable manual session");
    assert!(s.create_session_with_id(Uuid::nil(), &input).is_err());
    let created = s.create_session_with_id(id, &input)?;
    assert_eq!(s.create_session_with_id(id, &input)?, created);
    let note = PersonalNoteRef {
        id: Uuid::new_v4(),
        relative_path: "notes/persisted.md".into(),
    };
    s.bind_session_note(&created.id, &note)?;
    let meeting = s.create_meeting_for_session(&created.id, "Canonical capture")?;
    let linked = s.session(&created.id)?.unwrap();
    assert_eq!(s.create_session_with_id(id, &input)?, linked);
    drop(s);
    let s = Store::open(d.path())?;
    assert_eq!(s.create_session_with_id(id, &input)?, linked);
    assert_eq!(
        s.create_meeting_for_session(&created.id, "Canonical capture")?,
        meeting
    );
    let mut edited = input.clone();
    edited.title = "Human edit".into();
    s.update_session(&created.id, &edited)?;
    assert!(s.create_session_with_id(id, &input).is_err());
    assert_eq!(s.session(&created.id)?.unwrap().title, "Human edit");
    let recording = s.create_meeting("Recording origin")?;
    assert!(s
        .create_session_with_id(
            Uuid::parse_str(&recording)?,
            &NewSession::manual("Recording origin")
        )
        .is_err());
    assert_eq!(s.list_sessions()?.len(), 2);
    Ok(())
}
