use super::*;
#[test]
fn full_turn_support_relevant_cohort_exclusions_and_capacity() -> Result<()> {
    let (_d, mut store, c, _meeting, _s) = fixture()?;
    history(&mut store, 1024, 2, 8)?;
    let job = large_query(&mut store, &c, 720, 2)?;
    // Add unrelated compatible exclusions and a different embedding space; neither fills the 1024 cohort.
    let first:(String,String,String,String,String)=store.profiles.query_row("SELECT assignment_id,person_id,space_id,vector_json,provenance_json FROM voice_sample LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
    let query_meeting: String =
        store
            .db
            .query_row("SELECT meeting_id FROM job WHERE id=?1", [&job], |r| {
                r.get(0)
            })?;
    let manifest: crate::capture::CaptureManifest = serde_json::from_reader(std::fs::File::open(
        store
            .root
            .join("raw")
            .join(&query_meeting)
            .join("manifest.json"),
    )?)?;
    let source_hash = manifest.tracks[0].sha256.clone().unwrap();
    let other_space = store.register_space(&EmbeddingSpace {
        revision: "unrelated".into(),
        ..result().turns[0].space.clone().unwrap()
    })?;
    for i in 0..24 {
        let mut p: Value = serde_json::from_str(&first.4)?;
        p["extra"] = json!(i);
        if i % 2 == 0 {
            p["meeting"] = json!(query_meeting);
            p["audio_sha256"] = json!(source_hash);
        }
        store.profiles.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) VALUES(?1,?2,2,?3,?4,?5,?6)",params![format!("excluded-{i}"),first.0,first.1,if i%2==0{&first.2}else{&other_space},first.3,serde_json::to_string(&p)?])?;
    }
    let before = store.profiles.total_changes();
    let input = store.prepare_voice_comparison(&job)?;
    assert!(input.accounted_workspace_bytes() <= 128 * 1024 * 1024);
    let output = input.score(&AtomicBool::new(false))?;
    for speaker in output["speakers"].as_array().unwrap() {
        assert_eq!(speaker["spaces"][0]["candidates"][0]["supportTurns"], 90);
    }
    assert_eq!(store.profiles.total_changes(), before);
    let large = large_query(&mut store, &c, 4096, 2)?;
    let output = store.voice_comparison(&large)?;
    for speaker in output["speakers"].as_array().unwrap() {
        assert_eq!(speaker["spaces"][0]["candidates"][0]["supportTurns"], 512);
    }
    let mut p: Value = serde_json::from_str(&first.4)?;
    p["extra"] = json!("above-cap");
    store.profiles.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) VALUES('above-cap',?1,2,?2,?3,?4,?5)",params![first.0,first.1,first.2,first.3,serde_json::to_string(&p)?])?;
    assert_eq!(
        store.voice_comparison(&large).unwrap_err().to_string(),
        CurationError::Capacity.to_string()
    );
    Ok(())
}
#[test]
fn checked_work_budget_and_cancellation_reject_without_partial_dto() -> Result<()> {
    let (_d, mut store, c, _, _) = fixture()?;
    history(&mut store, 1024, 512, 8)?;
    let job = large_query(&mut store, &c, 4096, 512)?;
    assert_eq!(
        store.voice_comparison(&job).unwrap_err().to_string(),
        CurationError::Capacity.to_string()
    );
    let job = large_query(&mut store, &c, 16, 512)?;
    assert_eq!(
        store
            .prepare_voice_comparison(&job)?
            .score(&AtomicBool::new(true))
            .unwrap_err()
            .to_string(),
        CurationError::Refresh.to_string()
    );
    Ok(())
}

#[test]
fn exact_frozen_v1_equivalence_and_owned_workspace_admission() -> Result<()> {
    let (_d, mut store, c, _, _) = fixture()?;
    history(&mut store, 24, 2, 6)?;
    let job = large_query(&mut store, &c, 40, 2)?;
    store.profiles.execute("UPDATE processed_candidate SET vector_json='[0.6,0.8]' WHERE job_id=?1 AND (cast(substr(turn_id,3) AS INTEGER)%2)=0",[&job])?;
    assert_eq!(
        store.voice_comparison(&job)?,
        store.voice_comparison_v1_reference(&job)?
    );
    let (_d, mut store, c, _, _) = fixture()?;
    history(&mut store, 1024, 2, 1024)?;
    let job = large_query(&mut store, &c, 128, 2)?;
    let raw: String = store.db.query_row(
        "SELECT result_json FROM processing_run WHERE job_id=?1",
        [&job],
        |r| r.get(0),
    )?;
    let mut output: ProcessingResult = serde_json::from_str(&raw)?;
    let prefix = "q".repeat(3200);
    for t in &mut output.turns {
        let prior = t.id.clone();
        t.id = format!("{prefix}{}", t.id);
        store.profiles.execute(
            "UPDATE processed_candidate SET turn_id=?1 WHERE job_id=?2 AND turn_id=?3",
            params![t.id, job, prior],
        )?;
    }
    store.db.execute(
        "UPDATE processing_run SET result_json=?1 WHERE job_id=?2",
        params![serde_json::to_string(&output)?, job],
    )?;
    assert_eq!(
        store
            .prepare_voice_comparison(&job)
            .err()
            .unwrap()
            .to_string(),
        CurationError::Capacity.to_string()
    );
    Ok(())
}
