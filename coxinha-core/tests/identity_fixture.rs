//! Opt-in lifecycle evidence using an isolated backup of public validation fixtures.
use anyhow::{ensure, Context, Result};
use coxinha_core::{
    identity::{Calibration, EmbeddingSpace, MatchResult},
    store::Store,
};
use rusqlite::{Connection, OpenFlags};
use std::{collections::BTreeSet, path::Path};
#[derive(Clone)]
struct Candidate {
    speaker: String,
    space: EmbeddingSpace,
    vector: Vec<f32>,
}
fn candidates(root: &Path, job: &str) -> Result<Vec<Candidate>> {
    let db = Connection::open_with_flags(
        root.join("private/profiles.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut q=db.prepare("SELECT speaker,space_json,vector_json FROM processed_candidate WHERE job_id=?1 AND speaker!='unknown' ORDER BY turn_id")?;
    let rows = q.query_map([job], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    rows.map(|r| {
        let (s, p, v) = r?;
        Ok(Candidate {
            speaker: s,
            space: serde_json::from_str(&p)?,
            vector: serde_json::from_str(&v)?,
        })
    })
    .collect()
}
fn cosine(a: &[f32], b: &[f32]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(a, b)| *a as f64 * *b as f64).sum();
    let norm = |v: &[f32]| v.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt();
    dot / (norm(a) * norm(b))
}
#[test]
#[ignore = "requires completed public speech fixtures; never runs against user libraries"]
fn public_fixture_identity_lifecycle() -> Result<()> {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    // Explicit test-only roots must remain under this repository's validation output.
    let evidence = match std::env::var_os("COXINHA_IDENTITY_FIXTURE_ROOT") {
        Some(path) => {
            let path = std::path::PathBuf::from(path).canonicalize()?;
            ensure!(
                path.starts_with(repo.join("target").canonicalize()?)
                    && path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .is_some_and(|s| s.starts_with("recognition-validation")),
                "fixture override must be repository target/recognition-validation* output"
            );
            path
        }
        None => repo.join("target/processing-validation"),
    };
    let original = evidence.join("library");
    let ids: serde_json::Value =
        serde_json::from_reader(std::fs::File::open(evidence.join("imported.json"))?)?;
    let first = ids["two-sources"]
        .as_str()
        .context("missing training fixture")?;
    let recurrence = ids["recurrence"]
        .as_str()
        .context("missing held-out fixture")?;
    ensure!(first != recurrence, "recurrence must be held out");
    let isolated = tempfile::tempdir()?;
    let copy = isolated.path().join("identity-library");
    {
        let source = Store::open(&original)?;
        source.processing_report(first)?;
        source.processing_report(recurrence)?;
        source.backup(&copy)?;
    }
    let mut store = Store::open(&copy)?;
    let training = store.processing_report(first)?;
    let heldout = store.processing_report(recurrence)?;
    let train = candidates(&copy, &training.job)?;
    let probes = candidates(&copy, &heldout.job)?;
    ensure!(
        !train.is_empty() && !probes.is_empty(),
        "actual engine candidates required"
    );
    let speakers: BTreeSet<_> = train.iter().map(|c| c.speaker.clone()).collect();
    ensure!(
        speakers.len() >= 2,
        "two distinct anonymous training speakers required"
    );
    let mut assignments = Vec::new();
    for (i, speaker) in speakers.iter().enumerate() {
        let person = store.create_person(
            &format!("Public fixture person {}", i + 1),
            &[],
            "isolated public fixture test only",
        )?;
        let assignment = store.confirm_processed_speaker(
            &training.job,
            speaker,
            &person,
            "explicit fixture human mapping; no acoustic identity claim",
        )?;
        let samples = store.enroll_processed_speaker(&assignment, &training.job, speaker)?;
        ensure!(!samples.is_empty(), "confirmed candidate not enrolled");
        assignments.push((assignment, person));
    }
    let mut metrics = Vec::new();
    for probe in &probes {
        let space = store.register_space(&probe.space)?;
        assert!(matches!(
            store.match_voice(&space, &probe.vector, None)?,
            MatchResult::Unknown { .. }
        ));
        for speaker in &speakers {
            let max = train
                .iter()
                .filter(|c| &c.speaker == speaker)
                .map(|c| cosine(&probe.vector, &c.vector))
                .fold(-1., f64::max);
            metrics.push(serde_json::json!({"heldout_cluster":probe.speaker,"training_cluster":speaker,"maximum_cosine":max}));
        }
    }
    // Only lifecycle plumbing: deliberately permissive test policy is not calibration evidence.
    for (assignment, _) in &assignments {
        store.decide_assignment(assignment, None, "revoked", "fixture revocation")?;
    }
    let probe = &probes[0];
    let space = store.register_space(&probe.space)?;
    let fixture_policy = Calibration {
        space_id: space.clone(),
        evidence: "TEST ONLY permissive plumbing policy; no calibrated accuracy".into(),
        minimum_samples: 1,
        minimum_duration_ms: 1,
        cosine_threshold: -1.,
        candidate_margin: 0.,
    };
    assert!(matches!(
        store.match_voice(&space, &probe.vector, Some(&fixture_policy))?,
        MatchResult::Unknown { .. }
    ));
    let speaker = speakers.first().unwrap();
    let person = store.create_person("Fixture correction target", &[], "explicit isolated test")?;
    let assignment = store.confirm_processed_speaker(
        &training.job,
        speaker,
        &person,
        "fixture corrected identity",
    )?;
    store.enroll_processed_speaker(&assignment, &training.job, speaker)?;
    let corrected = store.create_person(
        "Fixture second correction target",
        &[],
        "explicit isolated test",
    )?;
    store.decide_assignment(
        &assignment,
        Some(&corrected),
        "confirmed",
        "fixture correction invalidates previous samples",
    )?;
    assert!(matches!(
        store.match_voice(&space, &probe.vector, Some(&fixture_policy))?,
        MatchResult::Unknown { .. }
    ));
    store.enroll_processed_speaker(&assignment, &training.job, speaker)?;
    store.decide_assignment(&assignment, None, "revoked", "fixture final revoke")?;
    assert!(matches!(
        store.match_voice(&space, &probe.vector, Some(&fixture_policy))?,
        MatchResult::Unknown { .. }
    ));
    let people = store.list_people()?.len();
    let export = isolated.path().join("export");
    store.export_meeting(first, &export)?;
    let public = std::fs::read_to_string(export.join("transcript.json"))?;
    assert!(!public.contains("embedding"));
    assert!(!public.contains("vector"));
    assert!(!export.join("private").exists());
    let backup = isolated.path().join("backup");
    store.backup(&backup)?;
    let restored = Store::open(&backup)?;
    assert_eq!(restored.list_people()?.len(), people);
    assert_eq!(
        restored.processing_report(first)?.assignments.len(),
        speakers.len()
    );
    let result = serde_json::json!({"training_meeting":first,"heldout_meeting":recurrence,"training_anonymous_speakers":speakers.len(),"training_candidates":train.len(),"heldout_candidates":probes.len(),"default_matches":"all unknown without calibration","correction_and_revocation":"invalidated contributions","export":"no embeddings or private storage","backup":"private people and decision history retained","metrics_are_not_calibration":true,"pairwise_cosine_metrics":metrics});
    std::fs::write(
        evidence.join("identity-lifecycle-evidence.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    println!("{result}");
    Ok(())
}
