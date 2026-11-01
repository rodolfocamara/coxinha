use super::*;
pub(super) fn worker(store: Store) -> Worker {
    Worker {
        curation: Default::default(),
        store,
        processing: None,
        error: None,
        finalization_failed: None,
        live: Default::default(),
        root: Default::default(),
        #[cfg(target_os = "linux")]
        active: None,
    }
}
#[test]
fn pending_validation_keeps_status_and_list_available_and_blocks_capture() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(directory.path()).unwrap();
    let id = store.create_meeting("responsive fixture").unwrap();
    let mut worker = worker(store);
    let (_sender, receive) = mpsc::channel();
    worker.processing = Some(ProcessingTask {
        meeting: id.clone(),
        prepared: None,
        receive,
        control: ProcessingControl::default(),
        thread: None,
    });
    worker.pump_processing();
    assert_eq!(
        worker.execute(Action::Status).unwrap()["processing"]["phase"],
        "validation"
    );
    assert_eq!(worker.execute(Action::List).unwrap()[0]["id"], id);
    assert!(worker
        .execute(Action::Start {
            session: None,
            title: "blocked".into(),
            mic: "none".into(),
            output: "none".into()
        })
        .unwrap_err()
        .to_string()
        .contains("processing"));
    assert!(worker
        .execute(Action::Recover(id))
        .unwrap_err()
        .to_string()
        .contains("processing"));
}
#[test]
fn inference_channel_failure_is_durable_retryable_and_does_not_publish_results() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(directory.path()).unwrap();
    let id = store.create_meeting("failure fixture").unwrap();
    let job = store
        .enqueue(
            &id,
            "local-processing",
            &coxinha_core::jobs::JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: "test".into(),
            },
        )
        .unwrap();
    assert!(store.claim(&job).unwrap());
    let input = PreparedProcessing {
        meeting: id.clone(),
        job: job.clone(),
        config: coxinha_core::processing::ProcessingConfig {
            engine_version: "test".into(),
            models: Default::default(),
            parameters: json!({}),
        },
        tracks: vec![],
    };
    let mut worker = worker(store);
    let (sender, receive) = mpsc::channel();
    worker.processing = Some(ProcessingTask {
        meeting: id.clone(),
        prepared: Some(input),
        receive,
        control: ProcessingControl::default(),
        thread: None,
    });
    sender.send(Err("synthetic model failure".into())).unwrap();
    worker.pump_processing();
    assert!(worker.processing.is_none());
    assert_eq!(worker.store.job_state(&job).unwrap(), "failed");
    assert!(worker.status()["error"]
        .as_str()
        .unwrap()
        .contains("synthetic model failure"));
    let detail = worker.processing_detail(&id, None).unwrap();
    assert!(detail["report"].is_null());
    assert_eq!(detail["jobs"][0]["error"], "synthetic model failure");
    worker.store.retry_job(&job).unwrap();
    assert!(worker.store.claim(&job).unwrap());
}
#[test]
fn desktop_shutdown_marks_inference_retryable_and_rejects_late_completion() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(directory.path()).unwrap();
    let id = store.create_meeting("shutdown fixture").unwrap();
    let job = store
        .enqueue(
            &id,
            "local-processing",
            &coxinha_core::jobs::JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: "test".into(),
            },
        )
        .unwrap();
    assert!(store.claim(&job).unwrap());
    let mut worker = worker(store);
    let (sender, receive) = mpsc::channel();
    worker.processing = Some(ProcessingTask {
        meeting: id.clone(),
        prepared: Some(PreparedProcessing {
            meeting: id.clone(),
            job: job.clone(),
            tracks: vec![],
            config: coxinha_core::processing::ProcessingConfig {
                engine_version: "test".into(),
                models: Default::default(),
                parameters: json!({}),
            },
        }),
        receive,
        control: ProcessingControl::default(),
        thread: None,
    });
    worker
        .execute(Action::Shutdown {
            allow_interrupted: false,
        })
        .unwrap();
    assert!(sender.send(Err("late result".into())).is_err());
    assert_eq!(worker.store.job_state(&job).unwrap(), "failed");
    assert!(worker.processing_detail(&id, None).unwrap()["report"].is_null());
    drop(worker);
    let reopened = Store::open(directory.path()).unwrap();
    reopened.recover_jobs().unwrap();
    assert_eq!(reopened.job_state(&job).unwrap(), "failed");
    reopened.retry_job(&job).unwrap();
    assert!(reopened.claim(&job).unwrap());
}
#[test]
fn desktop_shutdown_drops_preflight_without_a_persisted_job() {
    let directory = tempfile::tempdir().unwrap();
    let mut worker = worker(Store::open(directory.path()).unwrap());
    let (sender, receive) = mpsc::channel();
    worker.processing = Some(ProcessingTask {
        meeting: "fixture".into(),
        prepared: None,
        receive,
        control: ProcessingControl::default(),
        thread: None,
    });
    worker
        .execute(Action::Shutdown {
            allow_interrupted: false,
        })
        .unwrap();
    assert!(worker.processing.is_none());
    assert!(sender.send(Err("late preflight".into())).is_err());
}
#[test]
fn historical_processing_result_cannot_be_read_through_another_meeting() {
    let directory = tempfile::tempdir().unwrap();
    let worker = worker(Store::open(directory.path()).unwrap());
    let id = worker.store.create_meeting("privacy fixture").unwrap();
    let error = worker
        .processing_detail(&id, Some("unrelated-job"))
        .unwrap_err();
    assert!(error.to_string().contains("does not belong"));
}
