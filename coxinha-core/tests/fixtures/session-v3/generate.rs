use anyhow::Result;
use coxinha_core::{store::Store, jobs::JobInput, capture::{Recording, Track}};
fn main() -> Result<()> {
    let root = std::path::PathBuf::from(std::env::args().nth(1).unwrap());
    let mut store = Store::open(&root)?;
    let meeting = store.create_meeting("Captured v3 meeting")?;
    let mut recording = Recording::start(&store, &meeting, "synthetic mic", "synthetic output")?;
    recording.write_block(Track::Mic, &[0; 128], 10)?;
    recording.write_block(Track::Output, &[1; 128], 20)?;
    recording.finish(&store, false)?;
    let job = store.enqueue(&meeting, "fixture", &JobInput {
        artifact_sha256: "a".repeat(64), config_sha256: "b".repeat(64),
        model_sha256: "c".repeat(64), engine_version: "captured-v3".into(),
    })?;
    assert!(store.claim(&job)?);
    store.publish_artifact(&meeting, &job, br#"{"fixture":"immutable v3 artifact"}"#)?;
    store.finish_job(&job, None)?;
    store.edit(&meeting, "segment-1", "Human edit must survive migration")?;
    let person = store.create_person("Private fixture person", &[], "disposable fixture")?;
    let assignment = store.suggest_assignment(&meeting, "speaker_0", Some(&person))?;
    store.decide_assignment(&assignment, Some(&person), "confirmed", "fixture human decision")?;
    store.create_meeting("Captured meeting without audio")?;
    std::fs::write(root.join("fixture.json"), serde_json::to_vec_pretty(&serde_json::json!({"meeting":meeting,"job":job,"person":person}))?)?;
    Ok(())
}
