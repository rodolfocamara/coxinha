use super::*;
use crate::db::Db;
use uuid::Uuid;
pub(super) async fn fixture() -> (tempfile::TempDir, Arc<Storage>, Library) {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir(d.path().join("notes")).unwrap();
    std::fs::create_dir(d.path().join("daily")).unwrap();
    let storage = Arc::new(Storage::new(
        d.path().into(),
        Arc::new(Db::open(&d.path().join("index.db")).unwrap()),
    ));
    let library = Library::open(d.path().join("library"), None).unwrap();
    (d, storage, library)
}
#[tokio::test]
async fn no_audio_full_worker_flow_concurrent_ensure_and_restart() {
    let (d, storage, library) = fixture().await;
    let session = mutate(
        library.clone(),
        storage.clone(),
        Action::Session(SessionAction::Create(NewSession::manual("Manual session"))),
    )
    .await
    .unwrap();
    let id = session["id"].as_str().unwrap().to_owned();
    let (a, b) = tokio::join!(
        library.ensure_note(storage.clone(), id.clone()),
        library.ensure_note(storage.clone(), id.clone())
    );
    assert_eq!(a.unwrap()["personal_note"], b.unwrap()["personal_note"]);
    assert_eq!(library.ask(Action::List).await.unwrap(), json!([]));
    assert!(library
        .ensure_note(storage.clone(), Uuid::new_v4().to_string())
        .await
        .is_err());
    library.shutdown().await.unwrap();
    let library = Library::open(d.path().join("library"), None).unwrap();
    assert_eq!(
        library
            .ask(Action::Session(SessionAction::Detail(id)))
            .await
            .unwrap()["title"],
        "Manual session"
    );
    library.shutdown().await.unwrap();
}
#[tokio::test]
async fn authorized_ensure_outlives_cancelled_caller_and_exit_waits_for_it() {
    let (_d, storage, library) = fixture().await;
    let session = library
        .ask(Action::Session(SessionAction::Create(NewSession::manual(
            "Exit",
        ))))
        .await
        .unwrap();
    let id = session["id"].as_str().unwrap().to_owned();
    let writer = storage.hold_note_writer().await;
    let library2 = library.clone();
    let storage2 = storage.clone();
    let task = tokio::spawn(async move { library2.ensure_note(storage2, id).await });
    // Wait for intent commit, before taking the exit barrier.
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if !library
                .ask(Action::Session(SessionAction::Pending))
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .is_empty()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("intent must commit while publication is blocked");
    task.abort();
    let mut barrier = Box::pin(storage.quiesce());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), barrier.as_mut())
            .await
            .is_err(),
        "exit must wait while publication is blocked on note_writes"
    );
    assert!(storage.list_notes().await.unwrap().is_empty());
    drop(writer);
    let barrier = tokio::time::timeout(std::time::Duration::from_secs(5), barrier)
        .await
        .unwrap();
    library.shutdown().await.unwrap();
    storage.commit_shutdown(&barrier);
    drop(barrier);
    assert!(storage.mutation_permit().await.is_err());
    assert_eq!(storage.list_notes().await.unwrap().len(), 1);
}
#[tokio::test]
async fn startup_conflict_is_per_session_and_does_not_disable_other_notes() {
    let (d, storage, library) = fixture().await;
    let s = library
        .ask(Action::Session(SessionAction::Create(NewSession::manual(
            "Conflict",
        ))))
        .await
        .unwrap();
    let id = s["id"].as_str().unwrap().to_owned();
    let i: PersonalNoteIntent = serde_json::from_value(
        library
            .ask(Action::Session(SessionAction::Reserve(id.clone())))
            .await
            .unwrap(),
    )
    .unwrap();
    std::fs::write(d.path().join(i.relative_path), "Unrelated file").unwrap();
    let healthy = library
        .ask(Action::Session(SessionAction::Create(NewSession::manual(
            "Healthy pending",
        ))))
        .await
        .unwrap();
    let healthy_id = healthy["id"].as_str().unwrap().to_owned();
    library
        .ask(Action::Session(SessionAction::Reserve(healthy_id.clone())))
        .await
        .unwrap();
    library.shutdown().await.unwrap();
    let library = Library::open(d.path().join("library"), None).unwrap();
    library.reconcile_session_notes(storage.clone());
    for _ in 0..100 {
        if library
            .ask(Action::Session(SessionAction::Detail(id.clone())))
            .await
            .unwrap()["note_error"]
            .is_string()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(
        library
            .ask(Action::Session(SessionAction::Detail(id)))
            .await
            .unwrap()["note_error"],
        "session_note_conflict"
    );
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if !library
                .ask(Action::Session(SessionAction::Detail(healthy_id.clone())))
                .await
                .unwrap()["personal_note"]
                .is_null()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("one conflict must not prevent another intent from recovering");
    assert!(storage
        .create_note("Standalone", "# Standalone")
        .await
        .is_ok());
    library.shutdown().await.unwrap();
}

#[tokio::test]
async fn existing_session_uses_original_processing_job_and_private_context_stays_private() {
    let d = tempfile::tempdir().unwrap();
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../coxinha-core/tests/fixtures/session-v4/library");
    fn copy(from: &std::path::Path, to: &std::path::Path) {
        std::fs::create_dir_all(to).unwrap();
        for e in std::fs::read_dir(from).unwrap() {
            let e = e.unwrap();
            if e.file_type().unwrap().is_dir() {
                copy(&e.path(), &to.join(e.file_name()));
            } else {
                std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
            }
        }
    }
    copy(&fixture, d.path());
    let metadata: Value =
        serde_json::from_slice(&std::fs::read(d.path().join("fixture.json")).unwrap()).unwrap();
    let meeting = metadata["meeting"].as_str().unwrap();
    // Publish a synthetic transcript through the real core persistence API.
    // The captured v4 fixture's generic 'fixture' artifact is not a transcript.
    let model = d.path().join("synthetic-model");
    std::fs::write(&model, b"synthetic fixture model bytes").unwrap();
    use sha2::Digest;
    let hash = format!(
        "{:x}",
        sha2::Sha256::digest(b"synthetic fixture model bytes")
    );
    let config=serde_json::from_value(json!({"engine_version":"test-only","models":{"fixture":{"path":model,"sha256":hash,"provenance":"synthetic persistence test, no inference"}},"parameters":{}})).unwrap();
    let mut store = Store::open(d.path()).unwrap();
    let prepared = store.prepare_processing(meeting, &config).unwrap();
    assert!(store.claim(&prepared.job).unwrap());
    let output=serde_json::from_value(json!({"segments":[{"id":"synthetic-segment","track":"mic","start_ms":0,"end_ms":1,"text":"Synthetic transcript fixture","speaker":null}],"turns":[],"warnings":[]})).unwrap();
    store.commit_processing(&prepared, output).unwrap();
    drop(store);
    let library = Library::open(d.path().into(), None).unwrap();
    let sessions = library
        .ask(Action::Session(SessionAction::List))
        .await
        .unwrap();
    let session = sessions
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["meeting_id"] == meeting)
        .unwrap_or_else(|| panic!("missing fixture session {meeting}: {sessions}"));
    assert_eq!(session["recording"]["id"], meeting);
    assert_eq!(session["transcript_status"], "available");
    let session_detail = library
        .ask(Action::Session(SessionAction::Detail(
            session["id"].as_str().unwrap().into(),
        )))
        .await
        .unwrap();
    assert_eq!(session_detail["transcript_status"], "available");
    assert_eq!(session_detail["processing_state"], "succeeded");
    assert!(!session.to_string().contains("private@example"));
    let detail = library
        .ask(Action::Processing(
            meeting.into(),
            Some(prepared.job.clone()),
        ))
        .await
        .unwrap();
    assert_eq!(detail["report"]["job"], prepared.job);
    assert!(!detail["report"]["segments"].as_array().unwrap().is_empty());
    library.shutdown().await.unwrap();
}
