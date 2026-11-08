use super::*;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

fn input(id: &str, job: &str) -> PreparedProcessing {
    PreparedProcessing {
        meeting: id.into(),
        job: job.into(),
        tracks: vec![],
        config: coxinha_core::processing::ProcessingConfig {
            engine_version: "test".into(),
            models: Default::default(),
            parameters: json!({}),
        },
    }
}

#[test]
fn stopping_retains_exclusion_and_late_success_cannot_publish() {
    let dir = tempfile::tempdir().unwrap();
    let mut worker = tests::worker(Store::open(dir.path()).unwrap());
    let id = worker
        .store
        .create_meeting("synthetic cancellation")
        .unwrap();
    let job = worker
        .store
        .enqueue(
            &id,
            "local-processing",
            &coxinha_core::jobs::JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: "fake".into(),
            },
        )
        .unwrap();
    assert!(worker.store.claim(&job).unwrap());
    let (send, receive) = mpsc::channel();
    let (release, gate) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        let _ = gate.recv_timeout(Duration::from_secs(10));
        let _ = send.send(Ok(Completion::Inferred(ProcessingResult {
            segments: vec![],
            turns: vec![],
            warnings: vec![],
        })));
    });
    worker.processing = Some(ProcessingTask {
        meeting: id.clone(),
        prepared: Some(input(&id, &job)),
        receive,
        control: ProcessingControl::default(),
        thread: Some(thread),
    });
    assert!(worker
        .interrupt_processing()
        .unwrap_err()
        .to_string()
        .contains("stopping"));
    assert_eq!(worker.status()["processing"]["phase"], "stopping");
    assert_eq!(worker.store.job_state(&job).unwrap(), "running");
    // A capture starting meanwhile never requeues a run the exit cancelled.
    worker.yield_processing();
    assert!(worker.resume.pending.is_none());
    // Even explicit raw-preserving shutdown must not claim the actor has joined.
    assert!(worker
        .execute(Action::Shutdown {
            allow_interrupted: true
        })
        .is_err());
    assert!(worker.processing.is_some());
    release.send(()).unwrap();
    assert!(worker
        .processing
        .as_mut()
        .unwrap()
        .wait_for_exit(Duration::from_secs(5)));
    worker.pump_processing();
    assert!(worker.processing.is_none());
    assert_eq!(worker.store.job_state(&job).unwrap(), "failed");
    assert!(worker.processing_detail(&id, None).unwrap()["report"].is_null());
    worker
        .execute(Action::Shutdown {
            allow_interrupted: false,
        })
        .unwrap();
}

#[test]
fn a_sent_completion_does_not_release_a_still_running_thread() {
    let dir = tempfile::tempdir().unwrap();
    let mut worker = tests::worker(Store::open(dir.path()).unwrap());
    let (send, receive) = mpsc::channel();
    let (sent, seen) = mpsc::channel();
    let (release, gate) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        send.send(Err("synthetic completion".into())).unwrap();
        sent.send(()).unwrap();
        let _ = gate.recv_timeout(Duration::from_secs(10));
    });
    worker.processing = Some(ProcessingTask {
        meeting: "fake".into(),
        prepared: None,
        receive,
        control: ProcessingControl::default(),
        thread: Some(thread),
    });
    seen.recv_timeout(Duration::from_secs(5)).unwrap();
    worker.pump_processing();
    assert!(worker.processing.is_some());
    assert!(worker.error.is_none());
    release.send(()).unwrap();
    assert!(worker
        .processing
        .as_mut()
        .unwrap()
        .wait_for_exit(Duration::from_secs(5)));
    worker.pump_processing();
    assert!(worker.processing.is_none());
    assert_eq!(worker.error.as_deref(), Some("synthetic completion"));
}

#[test]
fn teardown_joins_before_releasing_the_library_lock() {
    let dir = tempfile::tempdir().unwrap();
    let mut worker = tests::worker(Store::open(dir.path()).unwrap());
    let control = ProcessingControl::default();
    let cancellation = control.clone();
    let still_locked = Arc::new(AtomicBool::new(false));
    let observed = still_locked.clone();
    let root = dir.path().to_owned();
    let (_send, receive) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        while !cancellation.is_cancelled() {
            std::thread::yield_now();
        }
        observed.store(Store::open(&root).is_err(), Ordering::Release);
    });
    worker.processing = Some(ProcessingTask {
        meeting: "fake".into(),
        prepared: None,
        receive,
        control,
        thread: Some(thread),
    });
    drop(worker);
    assert!(still_locked.load(Ordering::Acquire));
    assert!(Store::open(dir.path()).is_ok());
}

#[test]
fn a_capture_start_yields_processing_which_resumes_with_its_config_afterwards() {
    let dir = tempfile::tempdir().unwrap();
    let mut worker = tests::worker(Store::open(dir.path()).unwrap());
    let id = worker.store.create_meeting("yielding").unwrap();
    let job = worker
        .store
        .enqueue(
            &id,
            "local-processing",
            &coxinha_core::jobs::JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: "fake".into(),
            },
        )
        .unwrap();
    assert!(worker.store.claim(&job).unwrap());
    let control = ProcessingControl::default();
    let cancellation = control.clone();
    let (send, receive) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        while !cancellation.is_cancelled() {
            std::thread::yield_now();
        }
        // A result that lands after the yield is never published.
        let _ = send.send(Ok(Completion::Inferred(ProcessingResult {
            segments: vec![],
            turns: vec![],
            warnings: vec![],
        })));
    });
    worker.processing = Some(ProcessingTask {
        meeting: id.clone(),
        prepared: Some(input(&id, &job)),
        receive,
        control,
        thread: Some(thread),
    });
    let config = serde_json::to_value(input(&id, &job).config).unwrap();
    worker.resume.running = Some((id.clone(), config.clone()));
    worker.yield_processing();
    assert_eq!(worker.status()["processing"]["phase"], "stopping");
    assert_eq!(worker.resume.pending, Some((id.clone(), config)));
    assert!(worker
        .processing
        .as_mut()
        .unwrap()
        .wait_for_exit(Duration::from_secs(5)));
    worker.pump_processing();
    assert!(worker.processing.is_none());
    assert!(worker.error.is_none());
    assert_eq!(worker.store.job_state(&job).unwrap(), "failed");
    let jobs = worker.store.meeting_processing_jobs(&id).unwrap();
    assert_eq!(jobs[0]["error"], YIELDED);
    assert!(worker.processing_detail(&id, None).unwrap()["report"].is_null());
    // Idle again: the run restarts from its request, at once.
    worker.pump_resume();
    assert!(worker.resume.pending.is_none());
    #[cfg(feature = "local-processing")]
    {
        assert_eq!(worker.processing.as_ref().unwrap().meeting, id);
        assert!(worker
            .processing
            .as_mut()
            .unwrap()
            .wait_for_exit(Duration::from_secs(10)));
        worker.pump_processing();
    }
}
