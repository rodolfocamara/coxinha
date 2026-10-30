use super::*;
use coxinha_core::{
    capture::{Recording, Track},
    identity::EmbeddingSpace,
    processing::{ModelFile, ProcessingConfig, ProcessingResult, SpeakerTurn},
};
#[test]
fn private_curation_actions_preserve_old_confirm_and_revoke_commands() -> anyhow::Result<()> {
    let d = tempfile::tempdir()?;
    let mut store = Store::open(d.path().join("library"))?;
    let meeting = store.create_meeting("synthetic IPC")?;
    let mut recording = Recording::start(&store, &meeting, "fixture-mic", "fixture-output")?;
    for track in [Track::Mic, Track::Output] {
        for i in 0..12 {
            recording.write_block(track, &[13; 4000], (i + 1) * 83_333_334)?;
        }
    }
    recording.finish(&store, false)?;
    let path = d.path().join("model");
    std::fs::write(&path, b"synthetic model")?;
    let config = ProcessingConfig {
        engine_version: "synthetic-ipc".into(),
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
            start_ms: i * 300,
            end_ms: i * 300 + 200,
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
    let person = store.create_person("Private person", &[], "consent")?;
    let mut worker = Worker {
        curation: Default::default(),
        store,
        processing: None,
        error: None,
        finalization_failed: None,
        #[cfg(target_os = "linux")]
        active: None,
    };
    let confirm = |enroll| Action::ConfirmSpeaker {
        job: prepared.job.clone(),
        speaker: "speaker-0".into(),
        person: person.clone(),
        origin: "human".into(),
        enroll,
        track: None,
    };
    worker.execute(confirm(false))?;
    let list = worker.execute(Action::Curation(CurationAction::Candidates(
        prepared.job.clone(),
        "mic".into(),
        "speaker-0".into(),
    )))?;
    assert_eq!(list["turns"].as_array().unwrap().len(), 2);
    let assignment = list["assignmentId"].as_str().unwrap().to_string();
    let selection = SelectedEnrollment {
        job: prepared.job.clone(),
        track: "mic".into(),
        speaker: "speaker-0".into(),
        person_id: person.clone(),
        assignment_id: assignment.clone(),
        expected_assignment_revision: list["assignmentRevision"].as_i64().unwrap(),
        turn_ids: vec!["turn-0".into()],
        human_origin: "human selection".into(),
    };
    let enrolled = worker.execute(Action::Curation(CurationAction::Enroll(selection.clone())))?;
    let id = enrolled["sampleIds"][0].as_str().unwrap().to_string();
    assert_eq!(
        worker.execute(Action::Curation(CurationAction::Profiles))?["profiles"][0]["spaces"][0]
            ["activeCount"],
        1
    );
    assert_eq!(
        worker.execute(Action::Curation(CurationAction::Samples(person.clone())))?["samples"][0]
            ["state"],
        "active"
    );
    assert_eq!(
        worker.execute(Action::Curation(CurationAction::Comparison(
            prepared.job.clone()
        )))?["experimental"],
        true
    );
    worker.execute(Action::Curation(CurationAction::Revoke(
        person.clone(),
        id,
        "human revoke".into(),
    )))?;
    assert_eq!(
        worker.execute(Action::Curation(CurationAction::Profiles))?["profiles"][0]["revokedCount"],
        1
    );
    worker.execute(confirm(true))?;
    assert_eq!(
        worker.execute(Action::Curation(CurationAction::Profiles))?["profiles"][0]["spaces"][0]
            ["activeCount"],
        2,
        "legacy enrollment still includes all turns"
    );
    assert!(
        worker
            .execute(Action::Curation(CurationAction::Enroll(selection)))
            .is_err(),
        "stale selection fails after legacy reconfirm"
    );
    worker.execute(Action::RevokeAssignment(
        assignment,
        "legacy revoke without track".into(),
    ))?;
    assert_eq!(
        worker.execute(Action::Curation(CurationAction::Profiles))?["profiles"][0]
            ["invalidatedCount"],
        2
    );
    Ok(())
}
