use super::*;

#[test]
fn references_refuse_rebinding_duplicates_and_unsafe_inputs() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let a = s.create_session(&NewSession::manual("Occurrence A"))?;
    let b = s.create_session(&NewSession::manual("Occurrence B"))?;
    let note = PersonalNoteRef {
        id: Uuid::new_v4(),
        relative_path: "notes/meeting.md".into(),
    };
    s.bind_session_note(&a.id, &note)?;
    for other in [
        note.clone(),
        PersonalNoteRef {
            id: note.id,
            relative_path: "notes/another.md".into(),
        },
        PersonalNoteRef {
            id: Uuid::new_v4(),
            relative_path: note.relative_path.clone(),
        },
    ] {
        assert!(s.bind_session_note(&b.id, &other).is_err());
    }
    for other in [
        PersonalNoteRef {
            id: note.id,
            relative_path: "notes/moved.md".into(),
        },
        PersonalNoteRef {
            id: Uuid::new_v4(),
            relative_path: note.relative_path.clone(),
        },
    ] {
        assert!(s.bind_session_note(&a.id, &other).is_err());
    }
    for path in [
        "/notes/a.md",
        "notes/../a.md",
        "notes//a.md",
        "notes/./a.md",
        "C:/notes/a.md",
        "notes/a\\b.md",
        "private/profiles.md",
        "notes/a.txt",
        "notes/a.md\n",
        "notes/ a.md",
        "notes/a./b.md",
    ] {
        assert!(
            s.bind_session_note(
                &b.id,
                &PersonalNoteRef {
                    id: Uuid::new_v4(),
                    relative_path: path.into()
                }
            )
            .is_err(),
            "{path:?}"
        );
    }
    assert!(s
        .bind_session_note(
            &b.id,
            &PersonalNoteRef {
                id: Uuid::nil(),
                relative_path: "notes/nil.md".into()
            }
        )
        .is_err());
    assert!(s.bind_session_note("missing", &note).is_err());
    assert_eq!(s.session(&a.id)?.unwrap().personal_note, Some(note));
    assert!(s.session(&b.id)?.unwrap().personal_note.is_none());
    assert_eq!(s.list_sessions()?[0].id, b.id);
    Ok(())
}

#[test]
fn invalid_dates_and_titles_do_not_mutate_sessions() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    assert!(s.create_session(&NewSession::manual(" \n")).is_err());
    let a = s.create_session(&NewSession::manual("A"))?;
    for date in [
        "2026-02-29T12:00:00Z",
        "1900-02-29T12:00:00Z",
        "2026-04-31T12:00:00Z",
        "2026-10-24T24:00:00Z",
        "2026-10-24T12:60:00Z",
        "2026-10-24T12:00:60Z",
        "0000-01-01T00:00:00Z",
        "2026-00-01T00:00:00Z",
        "2026-10-24",
        "2026-10-24T12:00:00-03:00",
        "é026-10-24T12:00:00Z",
    ] {
        let mut input = NewSession::manual("Invalid");
        input.starts_at = Some(date.into());
        assert!(s.create_session(&input).is_err(), "{date}");
        assert!(s.update_session(&a.id, &input).is_err(), "{date}");
    }
    let mut input = NewSession::manual("Invalid end");
    input.ends_at = Some("2026-10-24T12:00:00Z".into());
    assert!(s.create_session(&input).is_err());
    input.starts_at = Some("2026-10-24T13:00:00Z".into());
    assert!(s.create_session(&input).is_err());
    assert_eq!(s.session(&a.id)?.unwrap(), a);
    assert_eq!(s.list_sessions()?.len(), 1);
    assert!(valid_utc("2000-02-29T00:00:00Z"));
    assert!(valid_utc("2024-02-29T23:59:59Z"));
    Ok(())
}
