use super::*;
use coxinha_core::{
    capture::{Recording, Track},
    processing::{ModelFile, ProcessingConfig},
};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

#[test]
fn desktop_retry_resumes_delivery_without_loading_an_inference_model() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path().join("library")).unwrap();
    let meeting = store.create_meeting("synthetic publication retry").unwrap();
    let mut recording =
        Recording::start(&store, &meeting, "synthetic-mic", "synthetic-output").unwrap();
    for track in [Track::Mic, Track::Output] {
        recording.write_block(track, &[1; 1000], 1000).unwrap();
    }
    recording.finish(&store, false).unwrap();
    let model = directory.path().join("not-an-inference-model");
    std::fs::write(&model, b"synthetic validation-only file").unwrap();
    let config = ProcessingConfig {
        engine_version: "fixture".into(),
        models: BTreeMap::from([(
            "fixture".into(),
            ModelFile {
                sha256: coxinha_core::artifacts::digest(&model).unwrap().0,
                path: model,
                provenance: "synthetic test, never infer".into(),
            },
        )]),
        parameters: json!({}),
    };
    let input = store.prepare_processing(&meeting, &config).unwrap();
    store.claim(&input.job).unwrap();
    let database = rusqlite::Connection::open(store.root.join("meetings.db")).unwrap();
    database.execute_batch("CREATE TRIGGER fail_publication BEFORE INSERT ON artifact BEGIN SELECT RAISE(FAIL,'synthetic failure'); END;").unwrap();
    let result = ProcessingResult {
        segments: vec![],
        turns: vec![],
        warnings: vec!["original result".into()],
    };
    assert!(store.commit_processing(&input, result).is_err());
    store
        .finish_job(&input.job, Some("retry publication"))
        .unwrap();
    database
        .execute_batch("DROP TRIGGER fail_publication;")
        .unwrap();
    drop(database);
    let mut worker = tests::worker(store);
    worker
        .start_processing(meeting.clone(), serde_json::to_value(config).unwrap())
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while worker.processing.is_some() && Instant::now() < deadline {
        worker.pump_processing();
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(worker.processing.is_none());
    assert!(worker.error.is_none(), "{:?}", worker.error);
    assert_eq!(worker.store.job_state(&input.job).unwrap(), "succeeded");
    assert_eq!(
        worker.store.processing_report(&meeting).unwrap().warnings,
        ["original result"]
    );
}
