use super::*;

#[tokio::test]
async fn transient_filesystem_error_is_not_persisted_and_retry_succeeds() {
    let (dir, storage, library) = super::tests::fixture().await;
    let session = library
        .ask(Action::Session(SessionAction::Create(NewSession::manual(
            "IO",
        ))))
        .await
        .unwrap();
    let id = session["id"].as_str().unwrap().to_owned();
    // Deterministic filesystem failure even when the test runs as root.
    std::fs::remove_dir(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join("notes"), "not a directory").unwrap();
    assert!(library
        .ensure_note(storage.clone(), id.clone())
        .await
        .is_err());
    let detail = library
        .ask(Action::Session(SessionAction::Detail(id.clone())))
        .await
        .unwrap();
    assert!(detail["note_error"].is_null());
    assert!(detail["personal_note"].is_null());
    std::fs::remove_file(dir.path().join("notes")).unwrap();
    std::fs::create_dir(dir.path().join("notes")).unwrap();
    assert!(library.ensure_note(storage, id).await.unwrap()["note_error"].is_null());
    library.shutdown().await.unwrap();
}

#[tokio::test]
async fn completion_errors_never_dispatch_a_durable_conflict() {
    for failure in ["library busy", "desktop shutdown committed", "IO failure"] {
        let (_dir, storage, real) = super::tests::fixture().await;
        let s = real
            .ask(Action::Session(SessionAction::Create(NewSession::manual(
                "Complete",
            ))))
            .await
            .unwrap();
        let id = s["id"].as_str().unwrap().to_owned();
        let reserved = real
            .ask(Action::Session(SessionAction::Reserve(id.clone())))
            .await
            .unwrap();
        real.shutdown().await.unwrap();
        let (sender, receiver) = std::sync::mpsc::sync_channel::<Request>(16);
        let mock = Library { sender };
        let worker = std::thread::spawn(move || {
            let reserve = receiver.recv().unwrap();
            assert!(matches!(
                reserve.action,
                Action::Session(SessionAction::Reserve(_))
            ));
            reserve.reply.send(Ok(reserved)).unwrap();
            let complete = receiver.recv().unwrap();
            assert!(matches!(
                complete.action,
                Action::Session(SessionAction::Complete(_, _))
            ));
            complete.reply.send(Err(failure.into())).unwrap();
            assert!(matches!(
                receiver.recv_timeout(std::time::Duration::from_millis(100)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ));
        });
        assert_eq!(mock.ensure_note(storage, id).await.unwrap_err(), failure);
        worker.join().unwrap();
    }
}
