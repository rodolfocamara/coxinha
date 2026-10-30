use super::tests::{fixture, output};
use crate::{identity::Calibration, recognition::ParticipantContext};
use anyhow::Result;
#[test]
fn single_import_private_context_unknown_and_policy_lifecycle() -> Result<()> {
    let (d, mut store, old, config) = fixture()?;
    let source = store.root.join("raw").join(&old).join("mic.wav");
    let original = std::fs::read(&source)?;
    let meeting = store.import_audio("single", &source)?;
    let input = store.prepare_processing(&meeting, &config)?;
    assert_eq!(input.tracks.len(), 1);
    assert_eq!(input.tracks[0].track, "imported");
    assert!(!store
        .root
        .join("raw")
        .join(&meeting)
        .join("output.wav")
        .exists());
    let mut result = output();
    result.segments[0].track = "imported".into();
    result.turns[0].track = "imported".into();
    store.claim(&input.job)?;
    store.commit_processing(&input, result)?;
    let people = vec![
        ParticipantContext {
            name: "Homonym".into(),
            email: Some("one@example.test".into()),
        },
        ParticipantContext {
            name: "Homonym".into(),
            email: Some("two@example.test".into()),
        },
    ];
    store.set_participant_context(&meeting, &people)?;
    assert!(store.participant_context(&old)?.is_empty());
    assert_eq!(store.participant_context(&meeting)?.len(), 2);
    assert!(store.list_people()?.is_empty());
    let person = store.create_person("Acoustic person", &[], "human")?;
    let assignment =
        store.confirm_processed_speaker(&input.job, "speaker-0", &person, "human naming only")?;
    let samples: i64 = store
        .profiles
        .query_row("SELECT count(*) FROM voice_sample", [], |r| r.get(0))?;
    assert_eq!(samples, 0);
    let before = store.recognition(&input.job)?;
    assert_eq!(before["speakers"][0]["state"], "unknown");
    assert_eq!(
        store
            .enroll_processed_speaker(&assignment, &input.job, "speaker-0")?
            .len(),
        1
    );
    let space: String = store
        .profiles
        .query_row("SELECT id FROM embedding_space", [], |r| r.get(0))?;
    let calibration = Calibration {
        space_id: space,
        evidence: "SYNTHETIC lifecycle test only, not acoustic acceptance".into(),
        minimum_samples: 1,
        minimum_duration_ms: 100,
        cosine_threshold: 0.9,
        candidate_margin: 0.1,
    };
    assert!(store
        .install_calibration_policy("bad", "1", &calibration, &serde_json::json!({}))
        .is_err());
    let evidence = serde_json::json!({"validation_status":"validated","disjoint_enrollment_calibration_test":true,"false_accepts":0,"unknown_speakers":1,"corpus_sha256":"a".repeat(64),"synthetic_test_only":true});
    store.install_calibration_policy("synthetic-v1", "1", &calibration, &evidence)?;
    let query = store.recognition(&input.job)?;
    assert_eq!(query["speakers"][0]["state"], "suggested");
    assert_eq!(query["speakers"][0]["policyId"], "synthetic-v1");
    store.revoke_calibration_policy("synthetic-v1")?;
    assert_eq!(
        store.recognition(&input.job)?["speakers"][0]["state"],
        "unknown"
    );
    assert_eq!(
        store.processing_report_by_job(&input.job)?.assignments[0].state,
        "confirmed"
    );
    let export = d.path().join("single-export");
    store.export_meeting(&meeting, &export)?;
    assert!(export.join("imported.wav").exists());
    let public = std::fs::read_to_string(export.join("transcript.json"))?;
    assert!(!public.contains("example.test"));
    assert!(!public.contains("calibration"));
    assert_eq!(std::fs::read(source)?, original);
    let bad = d.path().join("bad.wav");
    std::fs::write(&bad, b"not audio")?;
    assert!(store.import_audio("bad", &bad).is_err());
    assert_eq!(store.list_meetings()?.len(), 2);
    Ok(())
}
#[test]
#[cfg(unix)]
fn imported_manifest_rejects_symlink_and_track_count() -> Result<()> {
    let (_d, store, m, _) = fixture()?;
    let source = store.root.join("raw").join(&m).join("mic.wav");
    let imported = store.import_audio("single", &source)?;
    let path = store.root.join("raw").join(&imported).join("imported.wav");
    std::fs::remove_file(&path)?;
    std::os::unix::fs::symlink(source, &path)?;
    assert!(store.verify_raw(&imported).is_err());
    Ok(())
}

#[test]
fn explicit_track_binding_does_not_enroll_same_label_from_other_source() -> Result<()> {
    let (_d, mut store, meeting, config) = fixture()?;
    let input = store.prepare_processing(&meeting, &config)?;
    let mut result = output();
    let mut other = result.turns[0].clone();
    other.track = "output".into();
    other.id = "other-track".into();
    result.turns.push(other);
    store.claim(&input.job)?;
    store.commit_processing(&input, result)?;
    let person = store.create_person("Person", &[], "consent")?;
    assert!(store
        .confirm_processed_speaker(&input.job, "speaker-0", &person, "human")
        .is_err());
    let assignment = store.confirm_processed_track_speaker(
        &input.job,
        "speaker-0",
        Some("mic"),
        &person,
        "human",
    )?;
    assert_eq!(
        store
            .enroll_processed_speaker(&assignment, &input.job, "speaker-0")?
            .len(),
        1
    );
    let report = store.processing_report_by_job(&input.job)?;
    assert_eq!(report.assignments[0].track.as_deref(), Some("mic"));
    let mut changed = config;
    changed.engine_version = "different-run".into();
    let next = store.prepare_processing(&meeting, &changed)?;
    store.claim(&next.job)?;
    store.commit_processing(&next, output())?;
    assert!(store
        .processing_report_by_job(&next.job)?
        .assignments
        .is_empty());
    Ok(())
}
#[test]
fn failed_v3_private_migration_retains_v2_data_and_version() -> Result<()> {
    let directory = tempfile::tempdir()?;
    std::fs::create_dir(directory.path().join("private"))?;
    let path = directory.path().join("private/profiles.db");
    let db = rusqlite::Connection::open(&path)?;
    db.execute_batch(include_str!("../profiles.sql"))?;
    db.execute_batch(include_str!("private.sql"))?;
    db.execute_batch("CREATE TABLE participant_context(retained TEXT); INSERT INTO participant_context VALUES('retained');")?;
    db.pragma_update(None, "user_version", 2)?;
    drop(db);
    assert!(crate::store::Store::open(directory.path()).is_err());
    let db = rusqlite::Connection::open(path)?;
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))?,
        2
    );
    assert_eq!(
        db.query_row("SELECT retained FROM participant_context", [], |r| r
            .get::<_, String>(0))?,
        "retained"
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='calibration_policy'",
            [],
            |r| r.get::<_, i64>(0)
        )?,
        0
    );
    Ok(())
}

#[test]
fn naming_without_embedding_is_valid_but_enrollment_reports_no_sample() -> Result<()> {
    let (_d, mut store, meeting, config) = fixture()?;
    let input = store.prepare_processing(&meeting, &config)?;
    let mut result = output();
    result.turns[0].embedding = None;
    result.turns[0].space = None;
    store.claim(&input.job)?;
    store.commit_processing(&input, result)?;
    let person = store.create_person("Name only", &[], "consent")?;
    let assignment = store.confirm_processed_speaker(&input.job, "speaker-0", &person, "human")?;
    assert!(store
        .enroll_processed_speaker(&assignment, &input.job, "speaker-0")
        .unwrap_err()
        .to_string()
        .contains("no eligible"));
    assert_eq!(
        store.processing_report_by_job(&input.job)?.assignments[0].state,
        "confirmed"
    );
    Ok(())
}

#[test]
fn truncated_import_cleans_only_its_incomplete_meeting() -> Result<()> {
    let (d, store, meeting, _) = fixture()?;
    let source = store.root.join("raw").join(&meeting).join("mic.wav");
    let bad = d.path().join("truncated.wav");
    let mut bytes = std::fs::read(&source)?;
    bytes.truncate(bytes.len() - 32);
    std::fs::write(&bad, &bytes)?;
    assert!(store.import_audio("incomplete", &bad).is_err());
    assert_eq!(store.list_meetings()?.len(), 1);
    store.verify_raw(&meeting)?;
    assert_eq!(std::fs::read(bad)?, bytes);
    Ok(())
}

#[test]
fn enrollment_hashes_each_source_once_at_batch_boundaries() -> Result<()> {
    let (_d, mut store, meeting, config) = fixture()?;
    let input = store.prepare_processing(&meeting, &config)?;
    let mut result = output();
    result.turns = (0..10)
        .map(|i| {
            let mut turn = output().turns.remove(0);
            turn.id = format!("turn-{i}");
            turn.start_ms = i * 50;
            turn.end_ms = (i + 1) * 50;
            turn
        })
        .collect();
    store.claim(&input.job)?;
    store.commit_processing(&input, result)?;
    let person = store.create_person("Person", &[], "consent")?;
    let assignment = store.confirm_processed_speaker(&input.job, "speaker-0", &person, "human")?;
    crate::artifacts::DIGEST_CALLS.with(|count| count.set(0));
    assert_eq!(
        store
            .enroll_processed_speaker(&assignment, &input.job, "speaker-0")?
            .len(),
        10
    );
    assert_eq!(
        crate::artifacts::DIGEST_CALLS.with(|count| count.get()),
        4,
        "two sources checked before and after the batch, independent of turn count"
    );
    Ok(())
}

#[test]
fn legacy_dual_source_manifest_cannot_recover_as_single_source() -> Result<()> {
    let (_d, store, meeting, _) = fixture()?;
    let path = store.root.join("raw").join(&meeting).join("manifest.json");
    let mut manifest: serde_json::Value = serde_json::from_reader(std::fs::File::open(&path)?)?;
    manifest["tracks"].as_array_mut().unwrap().pop();
    std::fs::write(path, serde_json::to_vec(&manifest)?)?;
    assert!(store.recover_capture(&meeting).is_err());
    assert!(store.verify_raw(&meeting).is_err());
    Ok(())
}

#[test]
#[cfg(unix)]
fn recovery_rejects_external_symlink_before_header_or_journal_writes() -> Result<()> {
    let (d, store, meeting, _) = fixture()?;
    let directory = store.root.join("raw").join(&meeting);
    let manifest = directory.join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_reader(std::fs::File::open(&manifest)?)?;
    value["state"] = serde_json::json!("recording");
    std::fs::write(manifest, serde_json::to_vec(&value)?)?;
    let original = std::fs::read(directory.join("mic.wav"))?;
    let external = d.path().join("private-external.wav");
    std::fs::write(&external, &original)?;
    std::fs::remove_file(directory.join("mic.wav"))?;
    std::os::unix::fs::symlink(&external, directory.join("mic.wav"))?;
    assert!(store.recover_capture(&meeting).is_err());
    assert_eq!(std::fs::read(external)?, original);
    Ok(())
}
