use super::*;
use coxinha_core::{
    capture::{Recording, Track},
    identity::EmbeddingSpace,
    processing::{ModelFile, ProcessingConfig, ProcessingResult, SpeakerTurn},
};

/// A processed 3 s recording with two 1.2 s turns of `speaker-0` on the mic.
fn processed(root: &std::path::Path) -> anyhow::Result<(Store, String, String)> {
    let mut store = Store::open(root)?;
    let meeting = store.create_meeting("synthetic voices")?;
    let mut recording = Recording::start(&store, &meeting, "fixture-mic", "fixture-output")?;
    for track in [Track::Mic, Track::Output] {
        for i in 0..36 {
            recording.write_block(track, &[17; 4000], (i + 1) * 83_333_334)?;
        }
    }
    recording.finish(&store, false)?;
    let path = root.join("synthetic-model");
    std::fs::write(&path, b"synthetic model")?;
    let config = ProcessingConfig {
        engine_version: "synthetic-voices".into(),
        models: std::collections::BTreeMap::from([(
            "fixture".into(),
            ModelFile {
                sha256: coxinha_core::artifacts::digest(&path)?.0,
                path,
                provenance: "synthetic".into(),
            },
        )]),
        parameters: json!({}),
    };
    let prepared = store.prepare_processing(&meeting, &config)?;
    store.claim(&prepared.job)?;
    let turns = (0..2)
        .map(|i| SpeakerTurn {
            id: format!("turn-{i}"),
            track: "mic".into(),
            start_ms: i * 1300,
            end_ms: i * 1300 + 1200,
            speaker: "speaker-0".into(),
            embedding: Some(vec![1., 0.]),
            space: Some(EmbeddingSpace {
                model: "synthetic".into(),
                revision: "1".into(),
                model_hash: "a".repeat(64),
                preprocessing: "synthetic".into(),
                dimension: 2,
            }),
        })
        .collect();
    store.commit_processing(
        &prepared,
        ProcessingResult {
            turns,
            segments: vec![],
            warnings: vec![],
        },
    )?;
    let person = store.create_person("Synthetic participant", &[], "consent")?;
    Ok((store, prepared.job, person))
}
fn worker(store: Store) -> Worker {
    Worker {
        curation: Default::default(),
        store,
        processing: None,
        error: None,
        finalization_failed: None,
        live: Default::default(),
        root: Default::default(),
        voices: Default::default(),
        resume: Default::default(),
        #[cfg(target_os = "linux")]
        active: None,
    }
}
fn voice(worker: &mut Worker, job: &str) -> anyhow::Result<Value> {
    let report = worker.store.processing_report_by_job(job)?;
    Ok(json!(report.assignments[0].voice))
}
fn pump_until_remembered(worker: &mut Worker) {
    let start = worker.voices.generation;
    let deadline = Instant::now() + std::time::Duration::from_secs(20);
    while worker.voices.generation == start {
        assert!(Instant::now() < deadline, "voices never remembered");
        worker.voices.kick = true;
        worker.pump_voices();
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[test]
fn confirmation_never_waits_for_an_idle_library() -> anyhow::Result<()> {
    let d = tempfile::tempdir()?;
    let (store, job, person) = processed(&d.path().join("library"))?;
    let mut worker = worker(store);
    let before = worker.capture_signature();
    worker.execute(Action::ConfirmSpeaker {
        job: job.clone(),
        speaker: "speaker-0".into(),
        person,
        origin: "human".into(),
        track: Some("mic".into()),
    })?;
    assert_eq!(voice(&mut worker, &job)?["state"], "pending");
    pump_until_remembered(&mut worker);
    assert_eq!(
        voice(&mut worker, &job)?,
        json!({"state":"enrolled","samples":2})
    );
    assert_eq!(worker.execute(Action::Status)?["voices"]["generation"], 1);
    assert_ne!(worker.capture_signature(), before, "the UI hears about it");
    Ok(())
}

#[tokio::test]
async fn confirmations_from_before_a_restart_are_remembered_once() -> anyhow::Result<()> {
    let d = tempfile::tempdir()?;
    let root = d.path().join("library");
    let job = {
        let (mut store, job, person) = processed(&root)?;
        store.confirm_processed_track_speaker(&job, "speaker-0", Some("mic"), &person, "old")?;
        job
    };
    let library = Library::open(root.clone(), None)?;
    let deadline = Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let status = library
            .ask(Action::Status)
            .await
            .map_err(anyhow::Error::msg)?;
        if status["voices"]["generation"].as_u64() >= Some(1) {
            break;
        }
        assert!(Instant::now() < deadline, "backfill never ran");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    library.shutdown().await.map_err(anyhow::Error::msg)?;
    drop(library);
    let store = Store::open(&root)?;
    let report = store.processing_report_by_job(&job)?;
    let voice = report.assignments[0].voice.clone().unwrap();
    assert_eq!((voice.state.as_str(), voice.samples), ("enrolled", 2));
    assert_eq!(store.next_voice_meeting(&Default::default())?, None);
    Ok(())
}

#[test]
fn rejecting_retrying_and_forgetting_go_through_the_worker() -> anyhow::Result<()> {
    let d = tempfile::tempdir()?;
    let (store, job, person) = processed(&d.path().join("library"))?;
    let mut worker = worker(store);
    worker.execute(Action::Voice(VoiceAction::Reject {
        job: job.clone(),
        speaker: "speaker-0".into(),
        track: Some("mic".into()),
        origin: "not a participant".into(),
    }))?;
    assert_eq!(
        worker.store.processing_report_by_job(&job)?.assignments[0].state,
        "rejected"
    );
    worker.execute(Action::ConfirmSpeaker {
        job: job.clone(),
        speaker: "speaker-0".into(),
        person: person.clone(),
        origin: "human".into(),
        track: Some("mic".into()),
    })?;
    pump_until_remembered(&mut worker);
    let levels = worker.execute(Action::Voice(VoiceAction::Levels(job.clone())))?;
    assert_eq!(levels[0]["speaker"], "speaker-0");
    assert!(levels[0]["levelDb"].as_f64().unwrap() < -60.0);
    assert!(worker
        .execute(Action::Voice(VoiceAction::Retry(
            worker.store.processing_report_by_job(&job)?.assignments[0]
                .id
                .clone()
        )))
        .is_err());
    let forgotten = worker.execute(Action::Voice(VoiceAction::Forget(
        person.clone(),
        "asked to forget".into(),
    )))?;
    assert_eq!(forgotten["revoked"], 2);
    let memory = worker.execute(Action::Voice(VoiceAction::Memory(person.clone())))?;
    assert_eq!(memory["off"], true);
    worker.execute(Action::Voice(VoiceAction::RememberAgain(person)))?;
    pump_until_remembered(&mut worker);
    assert_eq!(voice(&mut worker, &job)?["samples"], 2);
    Ok(())
}
