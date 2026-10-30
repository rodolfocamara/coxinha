use super::*;
use crate::{
    capture::{Recording, Track},
    store::Store,
};
use anyhow::Result;
pub(super) fn fixture() -> Result<(tempfile::TempDir, Store, String, ProcessingConfig)> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path().join("library"))?;
    let m = s.create_meeting("fixture")?;
    let mut r = Recording::start(&s, &m, "fixture-mic", "fixture-output")?;
    for track in [Track::Mic, Track::Output] {
        for i in 0..12 {
            r.write_block(track, &[13; 4000], (i + 1) * 83_333_334)?;
        }
    }
    r.finish(&s, false)?;
    let path = d.path().join("model");
    std::fs::write(&path, b"explicit local fixture")?;
    let mut models = BTreeMap::new();
    models.insert(
        "fixture".into(),
        ModelFile {
            sha256: crate::artifacts::digest(&path)?.0,
            path,
            provenance: "test only".into(),
        },
    );
    Ok((
        d,
        s,
        m,
        ProcessingConfig {
            engine_version: "fixture-v1".into(),
            models,
            parameters: serde_json::json!({}),
        },
    ))
}
pub(super) fn output() -> ProcessingResult {
    ProcessingResult {
        segments: vec![TranscriptSegment {
            id: "segment".into(),
            track: "mic".into(),
            start_ms: 0,
            end_ms: 500,
            text: "machine".into(),
            speaker: Some("speaker-0".into()),
        }],
        turns: vec![SpeakerTurn {
            id: "turn".into(),
            track: "mic".into(),
            start_ms: 0,
            end_ms: 500,
            speaker: "speaker-0".into(),
            embedding: Some(vec![1., 0.]),
            space: Some(EmbeddingSpace {
                model: "fixture".into(),
                revision: "1".into(),
                model_hash: "a".repeat(64),
                preprocessing: "fixture".into(),
                dimension: 2,
            }),
        }],
        warnings: vec!["uncalibrated; unknown voice".into()],
    }
}
#[test]
fn durable_private_candidates_corrections_and_reprocessing() -> Result<()> {
    let (d, mut s, m, mut c) = fixture()?;
    let p = s.prepare_processing(&m, &c)?;
    assert_eq!(p.job, s.prepare_processing(&m, &c)?.job);
    assert!(s.claim(&p.job)?);
    assert!(Recording::start(&s, &s.create_meeting("busy")?, "a", "b").is_err());
    s.commit_processing(&p, output())?;
    assert!(!s.claim(&p.job)?);
    s.edit(&m, &format!("{}:segment", p.job), "human correction")?;
    assert_eq!(
        s.processing_report(&m)?.corrections["segment"],
        "human correction"
    );
    let person = s.create_person("Person", &[], "explicit test consent")?;
    let assignment = s.confirm_processed_speaker(&p.job, "speaker-0", &person, "human")?;
    assert_eq!(
        s.enroll_processed_speaker(&assignment, &p.job, "speaker-0")?
            .len(),
        1
    );
    let export = d.path().join("export");
    s.export_meeting(&m, &export)?;
    let public = std::fs::read_to_string(export.join("transcript.json"))?;
    assert!(public.contains("human correction"));
    assert!(!public.contains("embedding"));
    assert!(!public.contains("vector"));
    c.engine_version = "fixture-v2".into();
    let newer = s.prepare_processing(&m, &c)?;
    assert!(s.claim(&newer.job)?);
    s.commit_processing(&newer, output())?;
    assert!(s.processing_report(&m)?.assignments.is_empty());
    assert_eq!(
        s.latest_edit(&m, &format!("{}:segment", p.job))?.as_deref(),
        Some("human correction")
    );
    s.decide_assignment(&assignment, None, "revoked", "human revoked")?;
    assert!(s
        .enroll_processed_speaker(&assignment, &p.job, "speaker-0")
        .is_err());
    Ok(())
}
#[test]
fn rejects_corruption_and_failure_is_retryable() -> Result<()> {
    let (_d, s, m, mut c) = fixture()?;
    c.models.values_mut().next().unwrap().sha256 = "0".repeat(64);
    assert!(s.prepare_processing(&m, &c).is_err());
    let hash = crate::artifacts::digest(&c.models.values().next().unwrap().path)?.0;
    c.models.values_mut().next().unwrap().sha256 = hash;
    let p = s.prepare_processing(&m, &c)?;
    assert!(s.claim(&p.job)?);
    s.finish_job(&p.job, Some("local model failure"))?;
    s.retry_job(&p.job)?;
    assert!(s.claim(&p.job)?);
    std::fs::write(&p.tracks[0].path, b"corrupt")?;
    assert!(preflight_processing(s.root.clone(), m, c).is_err());
    Ok(())
}
#[test]
fn migrates_v1_without_losing_human_edits() -> Result<()> {
    let d = tempfile::tempdir()?;
    std::fs::create_dir(d.path().join("private"))?;
    for (file, schema) in [
        ("meetings.db", include_str!("../schema.sql")),
        ("private/profiles.db", include_str!("../profiles.sql")),
    ] {
        let db = rusqlite::Connection::open(d.path().join(file))?;
        db.execute_batch(schema)?;
        db.pragma_update(None, "user_version", 1)?;
    }
    let s = Store::open(d.path())?;
    let m = s.create_meeting("retained")?;
    s.edit(&m, "old", "retained")?;
    drop(s);
    let s = Store::open(d.path())?;
    assert_eq!(s.latest_edit(&m, "old")?.as_deref(), Some("retained"));
    assert_eq!(
        s.db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))?,
        5
    );
    Ok(())
}
#[test]
fn failed_publication_retry_preserves_original_delivery_and_unknown_is_not_person() -> Result<()> {
    let (_d, mut s, m, c) = fixture()?;
    let p = s.prepare_processing(&m, &c)?;
    s.claim(&p.job)?;
    s.db.execute_batch("CREATE TRIGGER fail_publication BEFORE INSERT ON artifact BEGIN SELECT RAISE(FAIL,'fixture publication failure'); END;")?;
    assert!(s.commit_processing(&p, output()).is_err());
    s.finish_job(&p.job, Some("publication failed"))?;
    s.db.execute_batch("DROP TRIGGER fail_publication;")?;
    s.retry_job(&p.job)?;
    s.claim(&p.job)?;
    let mut result = output();
    result.turns[0].id = "replacement-turn".into();
    assert!(s
        .commit_processing(&p, result)
        .unwrap_err()
        .to_string()
        .contains("publication pending"));
    assert!(s.resume_processing_publication(&p)?);
    assert_eq!(s.processing_report(&m)?.turns[0].id, "turn");
    let count: i64 = s.profiles.query_row(
        "SELECT count(*) FROM processed_candidate WHERE job_id=?1",
        [&p.job],
        |r| r.get(0),
    )?;
    assert_eq!(count, 1);
    let person = s.create_person("Person", &[], "human consent")?;
    assert!(s
        .confirm_processed_speaker(&p.job, "unknown", &person, "human")
        .is_err());
    let a = s.confirm_processed_speaker(&p.job, "speaker-0", &person, "human")?;
    assert_eq!(
        s.enroll_processed_speaker(&a, &p.job, "speaker-0")?.len(),
        1
    );
    Ok(())
}
#[test]
fn verified_prepare_rejects_forged_paths_and_historical_report_keeps_correction() -> Result<()> {
    let (_d, mut s, m, c) = fixture()?;
    let mut p = preflight_processing(s.root.clone(), m.clone(), c.clone())?;
    p.tracks[0].path = p.tracks[1].path.clone();
    assert!(s.prepare_verified_processing(p).is_err());
    let p = s.prepare_processing(&m, &c)?;
    s.claim(&p.job)?;
    s.commit_processing(&p, output())?;
    s.edit(
        &m,
        &format!("{}:segment", p.job),
        "historical human correction",
    )?;
    assert_eq!(
        s.processing_report_by_job(&p.job)?.segments[0].text,
        "machine"
    );
    assert_eq!(
        s.processing_report_by_job(&p.job)?.corrections["segment"],
        "historical human correction"
    );
    Ok(())
}
#[test]
fn owned_inference_runs_off_store_thread_and_reuses_canonical_defaults() -> Result<()> {
    struct Engine(std::thread::ThreadId);
    impl ProcessingEngine for Engine {
        fn run(&mut self, input: PreparedProcessing) -> Result<ProcessingResult> {
            assert_ne!(self.0, std::thread::current().id());
            assert_eq!(input.tracks.len(), 2);
            Ok(output())
        }
    }
    let (_d, mut s, m, c) = fixture()?;
    let p = s.prepare_processing(&m, &c)?;
    let equivalent = p.config.clone();
    assert_eq!(p.job, s.prepare_processing(&m, &equivalent)?.job);
    assert!(s.claim(&p.job)?);
    let worker = execute_processing(p.clone(), Engine(std::thread::current().id()));
    assert_eq!(s.list_meetings()?.len(), 1);
    assert_eq!(s.job_state(&p.job)?, "running");
    s.commit_processing(&p, worker.join().unwrap()?)?;
    assert_eq!(s.job_state(&p.job)?, "succeeded");
    Ok(())
}
#[test]
fn enrollment_batch_revokes_new_samples_on_later_failure() -> Result<()> {
    let (_d, mut s, m, c) = fixture()?;
    let p = s.prepare_processing(&m, &c)?;
    s.claim(&p.job)?;
    let mut result = output();
    result.turns[0].id = "a".into();
    let mut duplicate = result.turns[0].clone();
    duplicate.id = "z".into();
    result.turns.push(duplicate);
    s.commit_processing(&p, result)?;
    let person = s.create_person("Fixture", &[], "explicit test")?;
    let assignment = s.confirm_processed_speaker(&p.job, "speaker-0", &person, "human")?;
    assert!(s
        .enroll_processed_speaker(&assignment, &p.job, "speaker-0")
        .is_err());
    let active: i64 = s.profiles.query_row(
        "SELECT count(*) FROM voice_sample WHERE revoked=0",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(active, 0);
    Ok(())
}
#[test]
fn corrupt_manifest_frame_count_returns_error_without_overflow() {
    assert!(crate::artifacts::raw_bytes(u64::MAX).is_err());
    assert_eq!(crate::artifacts::raw_bytes(48000).unwrap(), 96044);
}
