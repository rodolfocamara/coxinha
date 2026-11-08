use super::*;
use std::sync::{Arc, Barrier};

// Deliberately bypass the production library lock to adversarially exercise the
// real API SQL against competing connections. Normal Store::open refuses this.
fn competing_store(root: &std::path::Path) -> Result<Store> {
    let db = rusqlite::Connection::open(root.join("meetings.db"))?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.pragma_update(None, "foreign_keys", true)?;
    Ok(Store {
        db,
        profiles: rusqlite::Connection::open_in_memory()?,
        root: root.into(),
        _lock: std::fs::File::open(root.join("library.lock"))?,
    })
}

#[test]
fn concurrent_note_and_meeting_claims_have_one_winner() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let sessions = [
        s.create_session(&NewSession::manual("A"))?,
        s.create_session(&NewSession::manual("B"))?,
    ];
    let note = PersonalNoteRef {
        id: Uuid::new_v4(),
        relative_path: "notes/unique.md".into(),
    };
    let meeting = Uuid::new_v4().to_string();
    s.db.execute(
        "INSERT INTO meeting(id,title) VALUES(?1,'Competing meeting')",
        [&meeting],
    )?;
    for notes in [true, false] {
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = sessions
            .iter()
            .map(|session| {
                let store = competing_store(d.path()).unwrap();
                let (id, note, meeting, barrier) = (
                    session.id.clone(),
                    note.clone(),
                    meeting.clone(),
                    barrier.clone(),
                );
                std::thread::spawn(move || {
                    barrier.wait();
                    if notes {
                        store.bind_session_note(&id, &note).is_ok()
                    } else {
                        store.attach_meeting(&id, &meeting).is_ok()
                    }
                })
            })
            .collect();
        let winners = handles
            .into_iter()
            .map(|h| h.join().unwrap() as usize)
            .sum::<usize>();
        assert_eq!(winners, 1);
    }
    assert_eq!(
        s.list_sessions()?
            .iter()
            .filter(|x| x.personal_note.is_some())
            .count(),
        1
    );
    assert_eq!(
        s.list_sessions()?
            .iter()
            .filter(|x| x.meeting_id.is_some())
            .count(),
        1
    );
    Ok(())
}

#[test]
fn concurrent_different_bindings_cannot_replace_one_session_reference() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let id = s.create_session(&NewSession::manual("One owner"))?.id;
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|i| {
            let (store, id, barrier) = (
                competing_store(d.path()).unwrap(),
                id.clone(),
                barrier.clone(),
            );
            std::thread::spawn(move || {
                barrier.wait();
                store
                    .bind_session_note(
                        &id,
                        &PersonalNoteRef {
                            id: Uuid::new_v4(),
                            relative_path: format!("notes/{i}.md"),
                        },
                    )
                    .is_ok()
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| h.join().unwrap() as usize)
            .sum::<usize>(),
        1
    );
    assert!(s.session(&id)?.unwrap().personal_note.is_some());
    Ok(())
}

#[test]
fn competing_manual_first_creates_commit_only_one_meeting() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let id = s.create_session(&NewSession::manual("Prepared once"))?.id;
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|i| {
            let (store, id, barrier) = (
                competing_store(d.path()).unwrap(),
                id.clone(),
                barrier.clone(),
            );
            std::thread::spawn(move || {
                barrier.wait();
                store
                    .create_meeting_for_session(&id, &format!("Capture {i}"))
                    .ok()
            })
        })
        .collect();
    let winners: Vec<_> = handles
        .into_iter()
        .filter_map(|h| h.join().unwrap())
        .collect();
    assert_eq!(winners.len(), 1);
    assert_eq!(s.list_meetings()?.len(), 1);
    assert_eq!(s.list_sessions()?.len(), 1);
    assert_eq!(
        s.session(&id)?.unwrap().meeting_id.as_deref(),
        Some(winners[0].as_str())
    );
    assert_eq!(std::fs::read_dir(d.path().join("raw"))?.count(), 1);
    Ok(())
}

#[test]
fn concurrent_reserved_uuid_retries_return_one_identical_session() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let id = Uuid::new_v4();
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let (store, barrier) = (competing_store(d.path()).unwrap(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                store
                    .create_session_with_id(id, &NewSession::manual("Same request"))
                    .unwrap()
            })
        })
        .collect();
    let sessions: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(sessions[0], sessions[1]);
    assert_eq!(s.list_sessions()?.len(), 1);
    Ok(())
}
