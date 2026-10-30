use super::*;
use coxinha_core::jobs::JobInput;
use rusqlite::params;

fn worker(store: Store) -> Worker {
    Worker {
        curation: Default::default(),
        store,
        processing: None,
        error: None,
        finalization_failed: None,
        #[cfg(target_os = "linux")]
        active: None,
    }
}

fn output(text: Option<&str>) -> String {
    json!({
        "segments":text.map(|text|json!({"id":"segment","track":"mic","start_ms":0,"end_ms":1,"text":text,"speaker":null})).into_iter().collect::<Vec<_>>(),
        "turns":[],"warnings":[]
    }).to_string()
}

// Only touches this test's newly created disposable library, never operator data.
fn persist(store: &Store, meeting: &str, state: &str, payload: Option<&str>) -> String {
    let job = store
        .enqueue(
            meeting,
            "local-processing",
            &JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: uuid::Uuid::new_v4().to_string(),
            },
        )
        .unwrap();
    let db = rusqlite::Connection::open(store.root.join("meetings.db")).unwrap();
    db.execute("UPDATE job SET state=?2 WHERE id=?1", params![job, state])
        .unwrap();
    if let Some(payload) = payload {
        db.execute(
            "INSERT INTO processing_run(job_id,config_json,result_json) VALUES(?1,'{}',?2)",
            params![job, payload],
        )
        .unwrap();
    }
    job
}

fn projection(worker: &Worker, id: &str, status: &str, processing: Option<&str>) -> Value {
    let list = worker.session_action(SessionAction::List).unwrap();
    let item = list
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap();
    let detail = worker
        .session_action(SessionAction::Detail(id.into()))
        .unwrap();
    assert_eq!(item["transcript_status"], status);
    assert_eq!(detail["transcript_status"], item["transcript_status"]);
    assert_eq!(detail["processing_state"], json!(processing));
    assert_eq!(item["processing_state"], detail["processing_state"]);
    detail
}

#[test]
fn session_list_detail_parity_and_independent_latest_processing_state() {
    let dir = tempfile::tempdir().unwrap();
    let worker = worker(Store::open(dir.path()).unwrap());
    let manual = worker
        .store
        .create_session(&NewSession::manual("Manual"))
        .unwrap();
    projection(&worker, &manual.id, "none", None);
    let meeting = worker.store.create_meeting("Recorded fixture").unwrap();
    let session = worker.store.session_for_meeting(&meeting).unwrap().unwrap();
    projection(&worker, &session.id, "none", None);
    persist(&worker.store, &meeting, "succeeded", None);
    projection(&worker, &session.id, "none", Some("succeeded"));
    persist(&worker.store, &meeting, "succeeded", Some(&output(None)));
    projection(&worker, &session.id, "empty", Some("succeeded"));
    let transcript = persist(
        &worker.store,
        &meeting,
        "succeeded",
        Some(&output(Some("PUBLIC_TRANSCRIPT_SENTINEL"))),
    );
    for state in ["failed", "running"] {
        persist(&worker.store, &meeting, state, Some(&output(None)));
        projection(&worker, &session.id, "available", Some(state));
        assert_eq!(
            worker.store.processing_report(&meeting).unwrap().job,
            transcript
        );
    }
    persist(
        &worker.store,
        &meeting,
        "succeeded",
        Some(&output(Some(" \n\t"))),
    );
    projection(&worker, &session.id, "empty", Some("succeeded"));
    persist(&worker.store, &meeting, "succeeded", Some("{malformed"));
    projection(&worker, &session.id, "unavailable", Some("succeeded"));
    projection(&worker, &manual.id, "none", None);
}

#[test]
fn mixed_corruption_does_not_collapse_list_or_leak_transcript_or_private_context() {
    let dir = tempfile::tempdir().unwrap();
    let worker = worker(Store::open(dir.path()).unwrap());
    let healthy = worker.store.create_meeting("Healthy session").unwrap();
    let healthy_session = worker.store.session_for_meeting(&healthy).unwrap().unwrap();
    persist(
        &worker.store,
        &healthy,
        "succeeded",
        Some(&output(Some("PUBLIC_TRANSCRIPT_SENTINEL"))),
    );
    let bad_json = worker.store.create_meeting("Corrupt JSON session").unwrap();
    persist(&worker.store, &bad_json, "succeeded", Some("{"));
    let bad_type = worker.store.create_meeting("Corrupt type session").unwrap();
    persist(
        &worker.store,
        &bad_type,
        "succeeded",
        Some("{\"segments\":[{\"text\":5}],\"turns\":[],\"warnings\":[]}"),
    );
    let manual = worker
        .store
        .create_session(&NewSession::manual("Unrelated manual"))
        .unwrap();
    worker
        .store
        .create_person(
            "PRIVATE_FULL_NAME_SENTINEL",
            &[],
            "synthetic explicit consent",
        )
        .unwrap();
    worker
        .store
        .set_participant_context(
            &healthy,
            &[coxinha_core::recognition::ParticipantContext {
                name: "PRIVATE_CONTEXT_SENTINEL".into(),
                email: Some("private@example.test".into()),
            }],
        )
        .unwrap();
    let before = std::fs::read(dir.path().join("meetings.db")).unwrap();
    let private_before = std::fs::read(dir.path().join("private/profiles.db")).unwrap();
    // Coverage never verifies source files; these synthetic recordings have none.
    std::fs::remove_dir_all(dir.path().join("raw")).unwrap();
    let list = worker.session_action(SessionAction::List).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 4);
    projection(&worker, &healthy_session.id, "available", Some("succeeded"));
    for meeting in [&bad_json, &bad_type] {
        let session = worker.store.session_for_meeting(meeting).unwrap().unwrap();
        projection(&worker, &session.id, "unavailable", Some("succeeded"));
    }
    projection(&worker, &manual.id, "none", None);
    for session in worker.store.list_sessions().unwrap() {
        let detail = worker
            .session_action(SessionAction::Detail(session.id))
            .unwrap();
        for value in [&list, &detail] {
            let serialized = value.to_string();
            for forbidden in [
                "PUBLIC_TRANSCRIPT_SENTINEL",
                "PRIVATE_FULL_NAME_SENTINEL",
                "PRIVATE_CONTEXT_SENTINEL",
                "private@example.test",
                "embedding",
                "vector",
            ] {
                assert!(!serialized.contains(forbidden), "leaked {forbidden}");
            }
        }
    }
    assert_eq!(
        std::fs::read(dir.path().join("meetings.db")).unwrap(),
        before
    );
    assert_eq!(
        std::fs::read(dir.path().join("private/profiles.db")).unwrap(),
        private_before
    );
}
