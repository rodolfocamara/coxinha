use super::super::curation_worker::TestGate;
use super::*;
use coxinha_core::{
    capture::{Recording, Track},
    identity::EmbeddingSpace,
    processing::{ModelFile, ProcessingConfig, ProcessingResult, SpeakerTurn},
};
use std::sync::{Arc, Condvar, Mutex};

fn setup() -> anyhow::Result<(tempfile::TempDir, Library, String, String, String)> {
    let d = tempfile::tempdir()?;
    let root = d.path().join("library");
    let mut store = Store::open(&root)?;
    let meeting = store.create_meeting("synthetic request concurrency")?;
    let mut r = Recording::start(&store, &meeting, "fixture-mic", "fixture-output")?;
    for track in [Track::Mic, Track::Output] {
        for i in 0..12 {
            r.write_block(track, &[13; 4000], (i + 1) * 83_333_334)?;
        }
    }
    r.finish(&store, false)?;
    let path = d.path().join("model");
    std::fs::write(&path, b"synthetic")?;
    let config = ProcessingConfig {
        engine_version: "request-concurrency".into(),
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
    let p = store.prepare_processing(&meeting, &config)?;
    store.claim(&p.job)?;
    store.commit_processing(
        &p,
        ProcessingResult {
            segments: vec![],
            warnings: vec![],
            turns: vec![SpeakerTurn {
                id: "turn".into(),
                track: "mic".into(),
                start_ms: 0,
                end_ms: 200,
                speaker: "speaker".into(),
                embedding: Some(vec![1., 0.]),
                space: Some(EmbeddingSpace {
                    model: "fixture".into(),
                    revision: "1".into(),
                    model_hash: "a".repeat(64),
                    preprocessing: "synthetic".into(),
                    dimension: 2,
                }),
            }],
        },
    )?;
    let person = store.create_person("Synthetic person", &[], "synthetic")?;
    let assignment = store.confirm_processed_track_speaker(
        &p.job,
        "speaker",
        Some("mic"),
        &person,
        "synthetic",
    )?;
    let sample = store.enroll_selected_turns(&SelectedEnrollment {
        job: p.job.clone(),
        track: "mic".into(),
        speaker: "speaker".into(),
        assignment_id: assignment,
        person_id: person.clone(),
        expected_assignment_revision: 2,
        turn_ids: vec!["turn".into()],
        human_origin: "synthetic".into(),
    })?["sampleIds"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let held_out = store.create_meeting("synthetic held-out query")?;
    let mut r = Recording::start(&store, &held_out, "fixture-mic", "fixture-output")?;
    for track in [Track::Mic, Track::Output] {
        for i in 0..12 {
            r.write_block(track, &[27; 4000], (i + 1) * 83_333_334)?;
        }
    }
    r.finish(&store, false)?;
    let query = store.prepare_processing(&held_out, &config)?;
    store.claim(&query.job)?;
    let mut report = store.processing_report_by_job(&p.job)?;
    report.turns[0].embedding = Some(vec![1., 0.]);
    report.turns[0].space = Some(EmbeddingSpace {
        model: "fixture".into(),
        revision: "1".into(),
        model_hash: "a".repeat(64),
        preprocessing: "synthetic".into(),
        dimension: 2,
    });
    store.commit_processing(
        &query,
        ProcessingResult {
            turns: report.turns,
            segments: vec![],
            warnings: vec![],
        },
    )?;
    assert_eq!(
        store.voice_comparison(&query.job)?["speakers"][0]["spaces"][0]["candidates"][0]
            ["personId"],
        person
    );
    drop(store);
    let library = Library::open(root)?;
    Ok((d, library, query.job, person, sample))
}
fn request(
    library: &Library,
    action: Action,
) -> tokio::sync::oneshot::Receiver<Result<Value, String>> {
    let (reply, receive) = tokio::sync::oneshot::channel();
    library.sender.send(Request { action, reply }).unwrap();
    receive
}
fn gate() -> (TestGate, mpsc::Receiver<()>) {
    let (send, receive) = mpsc::channel();
    (
        TestGate {
            entered: send,
            state: Arc::new((Mutex::new(false), Condvar::new())),
        },
        receive,
    )
}
#[tokio::test]
async fn actual_competing_requests_finish_while_scorer_is_held_and_stale_is_rejected() {
    let (_d, library, job, person, sample) = setup().unwrap();
    let (gate, entered) = gate();
    request(&library, Action::ComparisonGate(gate.clone()))
        .await
        .unwrap()
        .unwrap();
    let comparison = request(
        &library,
        Action::Curation(CurationAction::Comparison(job.clone())),
    );
    entered
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    assert!(request(&library, Action::Status)
        .await
        .unwrap()
        .unwrap()
        .get("processing")
        .is_some());
    assert_eq!(
        request(&library, Action::Curation(CurationAction::Comparison(job)))
            .await
            .unwrap()
            .unwrap_err(),
        CurationError::Busy.to_string()
    );
    request(
        &library,
        Action::Curation(CurationAction::Revoke(
            person,
            sample,
            "actual competing revoke".into(),
        )),
    )
    .await
    .unwrap()
    .unwrap();
    let meetings = request(&library, Action::List).await.unwrap().unwrap();
    let meeting = meetings[0]["id"].as_str().unwrap().to_owned();
    request(
        &library,
        Action::Edit(
            meeting,
            "synthetic-target".into(),
            "synthetic saved text".into(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        !*gate.state.0.lock().unwrap(),
        "status/revoke/save completed while scorer still held"
    );
    gate.release();
    assert_eq!(
        comparison.await.unwrap().unwrap_err(),
        CurationError::Refresh.to_string()
    );
    request(
        &library,
        Action::Shutdown {
            allow_interrupted: false,
        },
    )
    .await
    .unwrap()
    .unwrap();
}
#[tokio::test]
async fn actual_shutdown_cancels_held_scorer_joins_and_cannot_publish_late() {
    let (d, library, job, _, _) = setup().unwrap();
    let (gate, entered) = gate();
    request(&library, Action::ComparisonGate(gate))
        .await
        .unwrap()
        .unwrap();
    let comparison = request(&library, Action::Curation(CurationAction::Comparison(job)));
    entered
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    request(
        &library,
        Action::Shutdown {
            allow_interrupted: false,
        },
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        comparison.await.unwrap().unwrap_err(),
        CurationError::Refresh.to_string()
    );
    // Shutdown acknowledgement follows scorer join and Store drop, so immediate reopen is safe.
    let _reopened = Store::open(d.path().join("library")).unwrap();
}
#[tokio::test]
async fn actual_unchanged_generation_publishes_final_v1_value_and_accepts_next_request() {
    let (_d, library, job, _, _) = setup().unwrap();
    let first = request(
        &library,
        Action::Curation(CurationAction::Comparison(job.clone())),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(first["experimental"], true);
    assert!(first.get("speakers").is_some());
    assert_eq!(
        first,
        request(&library, Action::Curation(CurationAction::Comparison(job)))
            .await
            .unwrap()
            .unwrap()
    );
    request(
        &library,
        Action::Shutdown {
            allow_interrupted: false,
        },
    )
    .await
    .unwrap()
    .unwrap();
}
