use super::*;
use coxinha_core::capture::{Recording, Track};

#[tokio::test]
async fn worker_reopens_closed_audio_and_rejects_unknown_or_traversal_ids() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let id = store.create_meeting("synthetic lifecycle fixture").unwrap();
    let mut recording = Recording::start(&store, &id, "fixture-input", "fixture-monitor").unwrap();
    recording
        .write_block(Track::Mic, &[12; 960], 20_000_000)
        .unwrap();
    recording
        .write_block(Track::Output, &[-24; 960], 20_000_000)
        .unwrap();
    recording.finish(&store, false).unwrap();
    drop(store);
    let library = Library::open(temp.path().into()).unwrap();
    assert_eq!(
        library.ask(Action::List).await.unwrap()[0]["captureState"],
        "finished"
    );
    let detail = library.ask(Action::Detail(id.clone())).await.unwrap();
    assert_eq!(detail["meeting"]["id"], id);
    assert!(detail["audio"]["mic"]
        .as_str()
        .unwrap()
        .ends_with("mic.wav"));
    assert!(library
        .ask(Action::Detail("../private/profiles.db".into()))
        .await
        .is_err());
    assert!(library
        .ask(Action::Recover(uuid::Uuid::new_v4().to_string()))
        .await
        .is_err());
    library.shutdown().await.unwrap();
    assert!(library.ask(Action::Status).await.is_err());
}

#[cfg(unix)]
#[test]
fn playback_rejects_symlink_to_private_file_even_with_valid_checksum() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let id = store
        .create_meeting("private path synthetic fixture")
        .unwrap();
    let mut recording = Recording::start(&store, &id, "fixture-input", "fixture-monitor").unwrap();
    recording.write_block(Track::Mic, &[1; 960], 1).unwrap();
    recording.write_block(Track::Output, &[2; 960], 1).unwrap();
    recording.finish(&store, false).unwrap();
    drop(recording);
    let mic = temp.path().join("raw").join(&id).join("mic.wav");
    let private = temp.path().join("private/synthetic-sensitive.wav");
    std::fs::copy(&mic, &private).unwrap();
    std::fs::remove_file(&mic).unwrap();
    std::os::unix::fs::symlink(&private, &mic).unwrap();
    // Content hashes alone cannot authorize a path; raw verification rejects symlinks.
    assert!(store.verify_raw(&id).is_err());
    let worker = Worker {
        curation: Default::default(),
        processing: None,
        store,
        #[cfg(target_os = "linux")]
        active: None,
        error: None,
        finalization_failed: None,
    };
    let error = worker.detail(&id).unwrap_err().to_string();
    assert!(error.contains("symlink"), "{error}");
}

#[tokio::test]
async fn worker_recovers_unclean_capture_without_promoting_it_to_success() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let id = store.create_meeting("unclean synthetic fixture").unwrap();
    let mut recording = Recording::start(&store, &id, "fixture-input", "fixture-monitor").unwrap();
    recording
        .write_block(Track::Mic, &[7; 960], 20_000_000)
        .unwrap();
    drop(recording);
    drop(store);
    let library = Library::open(temp.path().into()).unwrap();
    assert!(library.ask(Action::Detail(id.clone())).await.unwrap()["audio"].is_null());
    let recovered = library.ask(Action::Recover(id.clone())).await.unwrap();
    assert_eq!(recovered["meeting"]["captureState"], "interrupted");
    assert_eq!(recovered["manifest"]["tracks"][0]["frames"], 960);
    assert_eq!(recovered["manifest"]["tracks"][1]["frames"], 0);
    assert!(recovered["audio"].is_object());
    std::fs::write(
        temp.path().join("raw").join(id).join("mic.wav"),
        b"corrupt fixture",
    )
    .unwrap();
    assert!(library
        .ask(Action::Detail(
            recovered["meeting"]["id"].as_str().unwrap().into()
        ))
        .await
        .is_err());
}

#[tokio::test]
async fn worker_recovers_interrupted_inference_for_explicit_retry() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let id = store
        .create_meeting("interrupted inference fixture")
        .unwrap();
    let job = store
        .enqueue(
            &id,
            "local-processing",
            &coxinha_core::jobs::JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: "fixture-v1".into(),
            },
        )
        .unwrap();
    assert!(store.claim(&job).unwrap());
    drop(store);
    let library = Library::open(temp.path().into()).unwrap();
    let detail = library.ask(Action::Processing(id, None)).await.unwrap();
    assert_eq!(detail["jobs"][0]["state"], "pending");
    assert_eq!(detail["jobs"][0]["error"], "interrupted before completion");
    assert!(detail["report"].is_null());
    assert!(library.ask(Action::Status).await.unwrap()["processing"].is_null());
}

#[cfg(not(feature = "local-processing"))]
#[tokio::test]
async fn missing_engines_are_an_actionable_failure() {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(temp.path().into()).unwrap();
    let error = library
        .ask(Action::Process(uuid::Uuid::new_v4().to_string(), json!({})))
        .await
        .unwrap_err();
    assert!(error.contains("--features local-processing"));
    assert!(library.ask(Action::Status).await.unwrap()["processing"].is_null());
}

#[tokio::test]
async fn worker_imports_single_track_and_keeps_manual_candidates_private() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("input.wav");
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut wav = hound::WavWriter::create(&path, spec).unwrap();
    for _ in 0..4800 {
        wav.write_sample(10i16).unwrap();
    }
    wav.finalize().unwrap();
    let library = Library::open(temp.path().join("library")).unwrap();
    let detail = library
        .ask(Action::ImportAudio(
            "single".into(),
            path.to_string_lossy().into(),
        ))
        .await
        .unwrap();
    assert_eq!(detail["manifest"]["version"], 2);
    assert_eq!(detail["manifest"]["tracks"].as_array().unwrap().len(), 1);
    assert!(detail["audio"]["imported"].is_string());
    assert!(detail["audio"]["output"].is_null());
    let id = detail["meeting"]["id"].as_str().unwrap().to_string();
    let rows = json!([{"name":"Candidate","email":"private@example.test"}]);
    assert_eq!(
        library
            .ask(Action::SetParticipantContext(id.clone(), rows.clone()))
            .await
            .unwrap(),
        rows
    );
    assert_eq!(
        library
            .ask(Action::ParticipantContext(id.clone()))
            .await
            .unwrap(),
        rows
    );
    assert!(!library
        .ask(Action::Detail(id))
        .await
        .unwrap()
        .to_string()
        .contains("private@example.test"));
    assert!(library
        .ask(Action::ImportAudio(
            "invalid".into(),
            temp.path().join("missing.wav").to_string_lossy().into()
        ))
        .await
        .is_err());
    assert_eq!(
        library
            .ask(Action::List)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn failed_finalization_blocks_exit_until_matching_recovery() {
    let temp = tempfile::tempdir().unwrap();
    let mut worker = Worker {
        curation: Default::default(),
        processing: None,
        store: Store::open(temp.path()).unwrap(),
        #[cfg(target_os = "linux")]
        active: None,
        error: None,
        finalization_failed: Some("unrecovered-recording".into()),
    };
    assert!(worker
        .execute(Action::Shutdown {
            allow_interrupted: false
        })
        .is_err());
    assert!(worker.execute(Action::Status).is_ok());
    assert!(worker
        .execute(Action::Shutdown {
            allow_interrupted: false
        })
        .is_err());
}

#[test]
fn explicit_exit_after_failed_finalization_preserves_raw_and_next_start_recovery() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let id = store.create_meeting("failed finalization fixture").unwrap();
    let mut recording = Recording::start(&store, &id, "fixture-mic", "fixture-output").unwrap();
    recording
        .write_block(Track::Mic, &[7; 960], 20_000_000)
        .unwrap();
    drop(recording);
    let raw = temp.path().join("raw").join(&id).join("mic.wav");
    let bytes_before = std::fs::read(&raw).unwrap();
    let mut worker = Worker {
        curation: Default::default(),
        processing: None,
        store,
        #[cfg(target_os = "linux")]
        active: None,
        error: None,
        finalization_failed: Some(id.clone()),
    };
    assert!(worker
        .execute(Action::Shutdown {
            allow_interrupted: false
        })
        .is_err());
    let result = worker
        .execute(Action::Shutdown {
            allow_interrupted: true,
        })
        .unwrap();
    assert_eq!(result["captureRecoveryRequired"], true);
    drop(worker);
    let store = Store::open(temp.path()).unwrap();
    let recovered = store.recover_capture(&id).unwrap();
    assert_eq!(recovered.state, "interrupted");
    assert_eq!(recovered.tracks[0].frames, 960);
    let bytes_after = std::fs::read(raw).unwrap();
    assert_eq!(&bytes_after[44..], &bytes_before[44..]);
}

#[tokio::test]
async fn shutdown_waits_for_saturated_queue_without_blocking_async_executor() {
    let (sender, receiver) = mpsc::sync_channel(1);
    let (reply, _receive) = tokio::sync::oneshot::channel();
    sender
        .send(Request {
            action: Action::Status,
            reply,
        })
        .unwrap();
    let library = Library { sender };
    let (release, gate) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        gate.recv().unwrap();
        receiver.recv().unwrap();
        let request = receiver.recv().unwrap();
        assert!(matches!(
            request.action,
            Action::Shutdown {
                allow_interrupted: false
            }
        ));
        request.reply.send(Ok(json!({}))).unwrap();
    });
    let ticker = tokio::spawn(async move {
        tokio::task::yield_now().await;
        release.send(()).unwrap();
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), library.shutdown())
        .await
        .unwrap()
        .unwrap();
    ticker.await.unwrap();
    worker.join().unwrap();
}
