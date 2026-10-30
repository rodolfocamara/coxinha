//! Controlled read-only worker stall at the real delete service boundary.
use super::*;

fn protected_snapshot(root: &Path, note: &PersonalNoteRef) -> Snapshot {
    let mut state = snapshot(root, &note.relative_path);
    state.index.clear();
    let db = rusqlite::Connection::open(root.join("index.db")).unwrap();
    for (table, key) in [("notes", "id"), ("notes_fts", "id"), ("links", "source_id")] {
        let mut query = db
            .prepare(&format!(
                "SELECT * FROM {table} WHERE {key}=?1 ORDER BY rowid"
            ))
            .unwrap();
        let columns = query.column_count();
        let records = query
            .query_map([note.id.to_string()], |row| {
                (0..columns)
                    .map(|i| row.get_ref(i).map(|v| format!("{v:?}")))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        state
            .index
            .extend(records.map(|row| format!("{table}: {:?}", row.unwrap())));
    }
    state
}

async fn stalled_query_case(cancel_caller: bool) {
    let (dir, storage, real) = fixture().await;
    let intent = reserve(&real).await;
    let session = real
        .ensure_note(storage.clone(), intent.session_id)
        .await
        .unwrap();
    let protected: PersonalNoteRef =
        serde_json::from_value(session["personal_note"].clone()).unwrap();
    let other = storage
        .create_note("Autosave", "# Before autosave")
        .await
        .unwrap();
    real.shutdown().await.unwrap();
    let before = protected_snapshot(dir.path(), &protected);
    let (sender, receiver) = std::sync::mpsc::sync_channel::<Request>(16);
    let mock = Library { sender };
    let st = storage.clone();
    let id = protected.id;
    let mut delete = tokio::spawn(async move { mock.delete_note(st, id).await });
    // Receiving the request proves the service holds its barrier and writer lock.
    // Keeping the reply sender models an import ahead of this read-only query.
    let request = tokio::task::spawn_blocking(move || {
        receiver.recv_timeout(std::time::Duration::from_secs(2))
    })
    .await
    .unwrap()
    .unwrap();
    assert!(
        matches!(request.action, Action::Session(sessions::SessionAction::ProtectsNote(note, _)) if note == id)
    );
    if cancel_caller {
        delete.abort();
        assert!((&mut delete).await.unwrap_err().is_cancelled());
    }
    let save = storage.update_note(other.id, "# After autosave");
    tokio::pin!(save);
    assert!(tokio::time::timeout(std::time::Duration::from_millis(30), save.as_mut()).await.is_err(), "save must remain excluded while the query is in flight, including after caller cancellation");
    let saved = tokio::time::timeout(std::time::Duration::from_secs(2), save.as_mut()).await;
    let delete_result = if cancel_caller {
        None
    } else {
        Some(tokio::time::timeout(std::time::Duration::from_millis(100), &mut delete).await)
    };
    // This deliberately unsafe late answer must find an abandoned receiver and
    // must never authorize deletion. Release it before assertions for red cleanup.
    let late_reply_rejected = request.reply.send(Ok(json!(false))).is_err();
    if saved.is_err() {
        save.await.unwrap();
    }
    let finished = match delete_result {
        Some(Ok(result)) => Some(result.unwrap()),
        Some(Err(_)) => Some(delete.await.unwrap()),
        None => None,
    };
    assert!(saved.is_ok(), "canonical query must release the exclusive barrier within its bounded deadline while the worker is still stalled");
    assert!(
        late_reply_rejected,
        "a late reply must not resume an abandoned delete operation"
    );
    if let Some(result) = finished {
        assert_eq!(
            result.unwrap_err(),
            "canonical session note protection query timed out"
        );
    }
    assert_eq!(
        storage.get_note(other.id).await.unwrap().markdown,
        "# After autosave"
    );
    assert_eq!(protected_snapshot(dir.path(), &protected), before);
}

#[tokio::test]
async fn stalled_canonical_query_times_out_releases_autosave_and_rejects_late_reply() {
    stalled_query_case(false).await;
}

#[tokio::test]
async fn cancelled_caller_keeps_exclusion_until_query_timeout_then_releases_autosave() {
    stalled_query_case(true).await;
}
