use super::*;
#[test]
fn selected_nonoverlap_survives_other_overlap_and_track_reused_label() -> Result<()> {
    let (_d, mut store, c, meeting, mut s) = fixture()?;
    let mut output = result();
    for (id, track, speaker, start, end) in [
        ("b", "mic", "speaker-0", 300, 600),
        ("c", "mic", "other", 400, 700),
        ("d", "output", "speaker-0", 0, 200),
    ] {
        let mut t = output.turns[0].clone();
        t.id = id.into();
        t.track = track.into();
        t.speaker = speaker.into();
        t.start_ms = start;
        t.end_ms = end;
        output.turns.push(t);
    }
    let mut config = c;
    config.engine_version = "overlap".into();
    s.job = process(&mut store, &meeting, &config, output)?;
    s.assignment_id = store.confirm_processed_track_speaker(
        &s.job,
        &s.speaker,
        Some(&s.track),
        &s.person_id,
        "human",
    )?;
    let list = store.enrollment_candidates(&s.job, &s.track, &s.speaker)?;
    assert_eq!(list["turns"][0]["eligible"], true);
    assert_eq!(list["turns"][1]["reasons"], json!(["same_track_overlap"]));
    assert_eq!(list["quality"]["echo"], "unmeasured");
    crate::artifacts::DIGEST_CALLS.with(|n| n.set(0));
    store.enrollment_candidates(&s.job, &s.track, &s.speaker)?;
    assert_eq!(
        crate::artifacts::DIGEST_CALLS.with(|n| n.get()),
        0,
        "listing does not hash/decode audio"
    );
    for ids in [
        vec!["b".into()],
        vec!["d".into()],
        vec!["a".into(), "b".into()],
    ] {
        let mut bad = s.clone();
        bad.turn_ids = ids;
        assert!(store.enroll_selected_turns(&bad).is_err());
    }
    assert_eq!(
        store.enroll_selected_turns(&s)?["sampleIds"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store.enrollment_candidates(&s.job, &s.track, &s.speaker)?["turns"][0]["activeSampleCount"],
        1
    );
    assert!(store.enroll_selected_turns(&s).is_err());
    Ok(())
}
#[test]
fn selection_rejects_empty_duplicates_foreign_scope_and_stale_revision_before_writes() -> Result<()>
{
    let (_d, mut store, _, _, s) = fixture()?;
    for (field, value) in [
        ("turnIds", json!([])),
        ("turnIds", json!(["a", "a"])),
        ("turnIds", json!(["foreign"])),
        ("turnIds", json!([""])),
        ("job", json!(uuid::Uuid::new_v4().to_string())),
        ("track", json!("output")),
        ("speaker", json!("foreign")),
        ("personId", json!(uuid::Uuid::new_v4().to_string())),
        ("assignmentId", json!(uuid::Uuid::new_v4().to_string())),
        ("humanOrigin", json!("\n")),
        ("expectedAssignmentRevision", json!(1)),
    ] {
        let mut value_s = serde_json::to_value(&s)?;
        value_s[field] = value;
        let bad: SelectedEnrollment = serde_json::from_value(value_s)?;
        assert!(store.enroll_selected_turns(&bad).is_err(), "field {field}");
        assert_eq!(count(&store)?, 0);
    }
    store.enroll_selected_turns(&s)?;
    store.decide_assignment(
        &s.assignment_id,
        Some(&s.person_id),
        "confirmed",
        "reconfirm",
    )?;
    assert!(store.enroll_selected_turns(&s).is_err());
    assert_eq!(count(&store)?, 1);
    Ok(())
}
#[test]
fn malformed_candidates_and_exact_provenance_are_rejected() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let original: String =
        store
            .profiles
            .query_row("SELECT provenance_json FROM processed_candidate", [], |r| {
                r.get(0)
            })?;
    for (key, value) in [
        ("meeting", json!(uuid::Uuid::new_v4().to_string())),
        ("track", json!("output")),
        ("start_ms", json!(1)),
        ("end_ms", json!(201)),
        ("audio_sha256", json!("b".repeat(64))),
    ] {
        let mut p: Value = serde_json::from_str(&original)?;
        p[key] = value;
        store.profiles.execute(
            "UPDATE processed_candidate SET provenance_json=?1",
            [serde_json::to_string(&p)?],
        )?;
        let list = store.enrollment_candidates(&s.job, &s.track, &s.speaker)?;
        assert!(list["turns"][0]["reasons"]
            .as_array()
            .unwrap()
            .contains(&json!("provenance_mismatch")));
        assert!(store.enroll_selected_turns(&s).is_err());
    }
    store.profiles.execute(
        "UPDATE processed_candidate SET provenance_json=?1",
        [original],
    )?;
    for vector in ["[0,0]", "[1]", "bad"] {
        store
            .profiles
            .execute("UPDATE processed_candidate SET vector_json=?1", [vector])?;
        assert!(store.enroll_selected_turns(&s).is_err());
    }
    store
        .profiles
        .execute("DELETE FROM processed_candidate", [])?;
    assert_eq!(
        store.enrollment_candidates(&s.job, &s.track, &s.speaker)?["turns"][0]["reasons"],
        json!(["missing_embedding"])
    );
    assert_eq!(count(&store)?, 0);
    Ok(())
}
#[test]
fn partial_insert_and_hash_mutation_rollback_preserve_prior_samples_and_confirmation() -> Result<()>
{
    let (_d, mut store, c, meeting, mut s) = fixture()?;
    let mut output = result();
    for (id, start, end) in [("b", 250, 450), ("c", 500, 700)] {
        let mut t = output.turns[0].clone();
        t.id = id.into();
        t.start_ms = start;
        t.end_ms = end;
        t.space.as_mut().unwrap().revision = "new-transactional-space".into();
        output.turns.push(t);
    }
    let mut config = c;
    config.engine_version = "batch".into();
    s.job = process(&mut store, &meeting, &config, output)?;
    s.assignment_id = store.confirm_processed_track_speaker(
        &s.job,
        &s.speaker,
        Some(&s.track),
        &s.person_id,
        "human",
    )?;
    store.enroll_selected_turns(&s)?;
    let generation_before = generation(&store)?;
    s.turn_ids = vec!["b".into(), "c".into()];
    store.profiles.execute_batch("CREATE TRIGGER reject_second BEFORE INSERT ON voice_sample WHEN json_extract(NEW.provenance_json,'$.start_ms')=500 BEGIN SELECT RAISE(FAIL,'synthetic second insert'); END;")?;
    assert!(store.enroll_selected_turns(&s).is_err());
    assert_eq!(count(&store)?, 1);
    assert_eq!(generation(&store)?, generation_before);
    assert_eq!(
        store
            .profiles
            .query_row("SELECT count(*) FROM embedding_space", [], |r| r
                .get::<_, i64>(0))?,
        1,
        "new embedding space rolls back with samples"
    );
    store.profiles.execute_batch("DROP TRIGGER reject_second")?;
    let path = store.root.join("raw").join(&meeting).join("mic.wav");
    let bytes = std::fs::read(&path)?;
    assert!(store
        .enroll_selected_checked(&s, || {
            let mut changed = bytes.clone();
            changed[50] ^= 1;
            std::fs::write(&path, changed)?;
            Ok(())
        })
        .is_err());
    assert_eq!(count(&store)?, 1);
    assert_eq!(generation(&store)?, generation_before);
    assert_eq!(
        store
            .profiles
            .query_row("SELECT count(*) FROM embedding_space", [], |r| r
                .get::<_, i64>(0))?,
        1
    );
    std::fs::write(path, bytes)?;
    assert_eq!(
        store.processing_report_by_job(&s.job)?.assignments[0].state,
        "confirmed"
    );
    store.enroll_selected_turns(&s)?;
    assert_eq!(count(&store)?, 3);
    Ok(())
}

#[test]
fn unknown_speaker_is_ineligible_and_new_embedding_space_can_reenroll_same_interval() -> Result<()>
{
    let (_d, mut store, c, meeting, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    let mut config = c;
    config.engine_version = "new-space".into();
    let mut output = result();
    output.turns[0].space.as_mut().unwrap().revision = "2".into();
    let mut unknown = output.turns[0].clone();
    unknown.id = "unknown-turn".into();
    unknown.speaker = "unknown".into();
    unknown.start_ms = 300;
    unknown.end_ms = 400;
    output.turns.push(unknown);
    let job = process(&mut store, &meeting, &config, output)?;
    let assignment = store.confirm_processed_track_speaker(
        &job,
        "speaker-0",
        Some("mic"),
        &s.person_id,
        "human",
    )?;
    let new = SelectedEnrollment {
        job: job.clone(),
        assignment_id: assignment,
        ..s
    };
    assert_eq!(
        store.enrollment_candidates(&job, "mic", "speaker-0")?["turns"][0]["activeSampleCount"],
        0
    );
    store.enroll_selected_turns(&new)?;
    assert!(
        store.enrollment_candidates(&job, "mic", "unknown")?["turns"][0]["reasons"]
            .as_array()
            .unwrap()
            .contains(&json!("unknown_speaker"))
    );
    assert_eq!(count(&store)?, 2);
    Ok(())
}
