use super::*;
#[test]
fn comparison_is_read_only_self_excluding_unknown_and_allows_fragments() -> Result<()> {
    let (_d, mut store, c, _meeting, s) = fixture()?;
    assert_eq!(
        store.voice_comparison(&s.job)?["speakers"][0]["spaces"][0]["status"],
        "no_compatible_history"
    );
    let sample = store.enroll_selected_turns(&s)?["sampleIds"][0]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        store.voice_comparison(&s.job)?["speakers"][0]["spaces"][0]["status"],
        "self_excluded"
    );
    let duplicate = query(&mut store, &c, 13, result())?;
    assert!(ranked(&store.voice_comparison(&duplicate)?).is_empty());
    let mut output = result();
    let mut fragment = output.turns[0].clone();
    fragment.id = "fragment".into();
    fragment.speaker = "speaker-1".into();
    fragment.start_ms = 250;
    fragment.end_ms = 500;
    output.turns.push(fragment);
    let job = query(&mut store, &c, 27, output)?;
    let before = store.profiles.total_changes();
    let db_before = store.db.total_changes();
    let gen_before = generation(&store)?;
    store.profiles.pragma_update(None, "query_only", true)?;
    store.db.pragma_update(None, "query_only", true)?;
    let comparison = store.voice_comparison(&job)?;
    assert_eq!(ranked(&comparison)[0]["personId"], s.person_id);
    assert_eq!(
        comparison["speakers"][1]["spaces"][0]["candidates"][0]["personId"],
        s.person_id
    );
    assert_eq!(ranked(&comparison)[0]["meanCosine"], 1.);
    assert_eq!(ranked(&comparison)[0]["supportDurationMs"], 200);
    assert_eq!(store.profiles.total_changes(), before);
    assert_eq!(store.db.total_changes(), db_before);
    assert_eq!(generation(&store)?, gen_before);
    assert_eq!(store.recognition(&job)?["speakers"][0]["state"], "unknown");
    store.profiles.pragma_update(None, "query_only", false)?;
    store.db.pragma_update(None, "query_only", false)?;
    store.revoke_voice_sample(&s.person_id, &sample, "human")?;
    assert!(ranked(&store.voice_comparison(&job)?).is_empty());
    Ok(())
}
#[test]
fn correction_mismatched_space_bad_history_and_homonyms_are_conservative() -> Result<()> {
    let (_d, mut store, c, _meeting, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    let job = query(&mut store, &c, 27, result())?;
    let person2 = store.create_person("Homonym", &[], "human")?;
    let a2 =
        store.confirm_processed_track_speaker(&job, "speaker-0", Some("mic"), &person2, "human")?;
    let s2 = SelectedEnrollment {
        job: job.clone(),
        assignment_id: a2,
        person_id: person2.clone(),
        ..s.clone()
    };
    store.enroll_selected_turns(&s2)?;
    let probe = query(&mut store, &c, 35, result())?;
    assert_eq!(ranked(&store.voice_comparison(&probe)?).len(), 2);
    let people: BTreeSet<_> = ranked(&store.voice_comparison(&probe)?)
        .iter()
        .map(|r| r["personId"].as_str().unwrap().to_owned())
        .collect();
    assert!(people.contains(&person2) && people.contains(&s.person_id));
    store.decide_assignment(&s.assignment_id, Some(&person2), "confirmed", "correction")?;
    let comparison = store.voice_comparison(&probe)?;
    assert_eq!(ranked(&comparison).len(), 1);
    assert_eq!(ranked(&comparison)[0]["personId"], person2);
    let mut mismatch = result();
    mismatch.turns[0].space.as_mut().unwrap().revision = "other".into();
    let incompatible = query(&mut store, &c, 44, mismatch)?;
    assert_eq!(
        store.voice_comparison(&incompatible)?["speakers"][0]["spaces"][0]["status"],
        "no_compatible_history"
    );
    store
        .profiles
        .execute("UPDATE voice_sample SET vector_json='bad'", [])?;
    let comparison = store.voice_comparison(&probe)?;
    assert!(ranked(&comparison).is_empty());
    assert_eq!(
        comparison["speakers"][0]["spaces"][0]["status"],
        "no_candidates"
    );
    Ok(())
}

#[test]
fn plain_mean_top_three_and_detail_cap_use_all_turns_and_do_not_mix_spaces() -> Result<()> {
    let (_d, mut store, c, _meeting, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    for seed in [21, 22, 23] {
        let job = query(&mut store, &c, seed, result())?;
        let person = store.create_person("Homonym", &[], "human")?;
        let assignment = store.confirm_processed_track_speaker(
            &job,
            "speaker-0",
            Some("mic"),
            &person,
            "human",
        )?;
        store.enroll_selected_turns(&SelectedEnrollment {
            job,
            assignment_id: assignment,
            person_id: person,
            ..s.clone()
        })?;
    }
    let mut output = result();
    output.turns = (0..40)
        .map(|i| {
            let mut t = result().turns.remove(0);
            t.id = format!("t-{i}");
            t.start_ms = i * 20;
            t.end_ms = i * 20 + 10;
            t.embedding = Some(if i < 32 { vec![1., 0.] } else { vec![0., 1.] });
            t
        })
        .collect();
    let mut incompatible = output.turns[0].clone();
    incompatible.id = "other-space".into();
    incompatible.start_ms = 850;
    incompatible.end_ms = 900;
    incompatible.space.as_mut().unwrap().revision = "2".into();
    output.turns.push(incompatible);
    let probe = query(&mut store, &c, 45, output)?;
    let comparison = store.voice_comparison(&probe)?;
    let spaces = comparison["speakers"][0]["spaces"].as_array().unwrap();
    assert_eq!(spaces.len(), 2);
    let compatible = spaces
        .iter()
        .find(|s| s["space"]["revision"] == "1")
        .unwrap();
    let ranking = compatible["candidates"].as_array().unwrap();
    assert_eq!(ranking.len(), 3);
    for candidate in ranking {
        assert_eq!(candidate["meanCosine"], 0.8);
        assert_eq!(candidate["supportTurns"], 40);
        assert_eq!(candidate["supportDurationMs"], 400);
        assert_eq!(candidate["turnDetailsTruncated"], true);
        assert_eq!(candidate["turns"].as_array().unwrap().len(), 32);
    }
    assert_eq!(
        spaces
            .iter()
            .find(|s| s["space"]["revision"] == "2")
            .unwrap()["status"],
        "no_compatible_history"
    );
    Ok(())
}
#[test]
fn comparison_uses_all_turns_beyond_selected_id_bound_and_rejects_bad_evidence() -> Result<()> {
    let (_d, mut store, c, _meeting, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    let mut output = result();
    output.turns = (0..129)
        .map(|i| {
            let mut t = result().turns.remove(0);
            t.id = format!("t-{i}");
            t.start_ms = i * 5;
            t.end_ms = i * 5 + 4;
            t
        })
        .collect();
    let probe = query(&mut store, &c, 27, output)?;
    assert_eq!(
        store.voice_comparison(&probe)?["speakers"][0]["spaces"][0]["candidates"][0]
            ["supportTurns"],
        129
    );
    store.profiles.execute(
        "UPDATE processed_candidate SET vector_json='[0,0]' WHERE job_id=?1",
        [&probe],
    )?;
    let comparison = store.voice_comparison(&probe)?;
    assert_eq!(
        comparison["speakers"][0]["queryStatus"],
        "no_eligible_turns"
    );
    assert_eq!(comparison["speakers"][0]["spaces"], json!([]));
    Ok(())
}
