use super::*;
use crate::{
    capture::{Recording, Track},
    curation::SelectedEnrollment,
    processing::{ModelFile, ProcessingConfig, ProcessingResult, SpeakerTurn},
};
mod comparison;
mod enrollment;
mod inventory;

fn result() -> ProcessingResult {
    ProcessingResult {
        segments: vec![],
        warnings: vec![],
        turns: vec![SpeakerTurn {
            id: "a".into(),
            track: "mic".into(),
            start_ms: 0,
            end_ms: 200,
            speaker: "speaker-0".into(),
            embedding: Some(vec![1., 0.]),
            space: Some(EmbeddingSpace {
                model: "synthetic".into(),
                revision: "1".into(),
                model_hash: "a".repeat(64),
                preprocessing: "synthetic-only".into(),
                dimension: 2,
            }),
        }],
    }
}
fn recording(store: &Store, seed: i16) -> Result<String> {
    let meeting = store.create_meeting("synthetic curation")?;
    let mut r = Recording::start(store, &meeting, "fixture-mic", "fixture-output")?;
    for track in [Track::Mic, Track::Output] {
        for i in 0..12 {
            r.write_block(track, &[seed; 4000], (i + 1) * 83_333_334)?;
        }
    }
    r.finish(store, false)?;
    Ok(meeting)
}
fn process(
    store: &mut Store,
    meeting: &str,
    config: &ProcessingConfig,
    result: ProcessingResult,
) -> Result<String> {
    let prepared = store.prepare_processing(meeting, config)?;
    ensure!(store.claim(&prepared.job)?, "fixture claim");
    store.commit_processing(&prepared, result)?;
    Ok(prepared.job)
}
fn fixture() -> Result<(
    tempfile::TempDir,
    Store,
    ProcessingConfig,
    String,
    SelectedEnrollment,
)> {
    let directory = tempfile::tempdir()?;
    let mut store = Store::open(directory.path().join("library"))?;
    let path = directory.path().join("synthetic-model");
    std::fs::write(&path, b"synthetic model for curation only")?;
    let config = ProcessingConfig {
        engine_version: "curation-test".into(),
        models: BTreeMap::from([(
            "fixture".into(),
            ModelFile {
                sha256: crate::artifacts::digest(&path)?.0,
                path,
                provenance: "synthetic".into(),
            },
        )]),
        parameters: json!({}),
    };
    let meeting = recording(&store, 13)?;
    let job = process(&mut store, &meeting, &config, result())?;
    let person = store.create_person("Homonym", &[], "private consent marker")?;
    let assignment =
        store.confirm_processed_track_speaker(&job, "speaker-0", Some("mic"), &person, "human")?;
    let selection = SelectedEnrollment {
        job,
        track: "mic".into(),
        speaker: "speaker-0".into(),
        assignment_id: assignment,
        person_id: person,
        expected_assignment_revision: 2,
        turn_ids: vec!["a".into()],
        human_origin: "manual selected enrollment".into(),
    };
    Ok((directory, store, config, meeting, selection))
}
fn count(store: &Store) -> Result<i64> {
    Ok(store
        .profiles
        .query_row("SELECT count(*) FROM voice_sample", [], |r| r.get(0))?)
}
fn ranked(value: &Value) -> &Vec<Value> {
    value["speakers"][0]["spaces"][0]["candidates"]
        .as_array()
        .unwrap()
}
fn query(
    store: &mut Store,
    config: &ProcessingConfig,
    seed: i16,
    output: ProcessingResult,
) -> Result<String> {
    let meeting = recording(store, seed)?;
    process(store, &meeting, config, output)
}

mod paging;
mod r2;

mod revoke_recovery;

mod r3;

mod r4;

mod r5;

mod r6;
