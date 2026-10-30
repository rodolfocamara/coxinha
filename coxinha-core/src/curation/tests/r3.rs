use super::*;

#[test]
fn long_names_are_admitted_by_real_identity_capacity_not_fixed_envelopes() -> Result<()> {
    let (_d, mut store, c, _, _) = fixture()?;
    super::r2::history(&mut store, 1024, 2, 1024)?;
    let job = super::r2::large_query(&mut store, &c, 256, 2)?;
    store
        .profiles
        .execute("UPDATE person SET name=?1", ["n".repeat(54 * 1024)])?;
    assert_eq!(
        store
            .prepare_voice_comparison(&job)
            .err()
            .unwrap()
            .to_string(),
        "voice_curation_capacity_exceeded"
    );
    store
        .profiles
        .execute("UPDATE person SET name=?1", ["n".repeat(16 * 1024)])?;
    let input = store.prepare_voice_comparison(&job)?;
    assert!(input.accounted_workspace_bytes() <= 128 * 1024 * 1024);
    let result = input.score(&std::sync::atomic::AtomicBool::new(false))?;
    assert_eq!(
        result["speakers"][0]["spaces"][0]["candidates"][0]["supportTurns"],
        32
    );
    Ok(())
}
#[test]
fn frozen_v1_invalid_vector_precedence_for_own_meeting_and_duplicate_audio() -> Result<()> {
    for duplicate in [false, true] {
        for raw in [
            "not-vector-json",
            "[0,0]",
            "[1]",
            "[1,0]",
            "[1,0,0]",
            "[1,0] trailing",
        ] {
            let (_d, mut store, c, _, s) = fixture()?;
            store.enroll_selected_turns(&s)?;
            let job = if duplicate {
                query(&mut store, &c, 13, result())?
            } else {
                s.job.clone()
            };
            store
                .profiles
                .execute("UPDATE voice_sample SET vector_json=?1", [raw])?;
            assert_eq!(
                store.voice_comparison_v1_reference(&job)?,
                store.voice_comparison(&job)?
            );
        }
    }
    Ok(())
}
#[test]
fn invalid_source_exclusions_keep_diagnostics_without_filling_relevant_quota() -> Result<()> {
    let (_d, mut store, c, _, _) = fixture()?;
    super::r2::history(&mut store, 1024, 2, 8)?;
    let job = super::r2::large_query(&mut store, &c, 720, 2)?;
    let meeting: String =
        store
            .db
            .query_row("SELECT meeting_id FROM job WHERE id=?1", [&job], |r| {
                r.get(0)
            })?;
    let manifest: crate::capture::CaptureManifest = serde_json::from_reader(std::fs::File::open(
        store.root.join("raw").join(&meeting).join("manifest.json"),
    )?)?;
    for i in 0u32..12 {
        let p = if i.is_multiple_of(2) {
            "json_set(provenance_json,'$.extra',?1,'$.meeting',?2)"
        } else {
            "json_set(provenance_json,'$.extra',?1,'$.audio_sha256',?2)"
        };
        let sql=format!("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) SELECT ?3,assignment_id,assignment_revision,person_id,space_id,'not-vector-json',{p} FROM voice_sample WHERE id='h-000000'");
        store.profiles.execute(
            &sql,
            params![
                i,
                if i.is_multiple_of(2) {
                    &meeting
                } else {
                    manifest.tracks[0].sha256.as_ref().unwrap()
                },
                format!("excluded-invalid-{i}")
            ],
        )?;
    }
    let result = store.voice_comparison(&job)?;
    for speaker in result["speakers"].as_array().unwrap() {
        assert_eq!(speaker["spaces"][0]["invalidHistorySamples"], 12);
        assert_eq!(speaker["spaces"][0]["candidates"][0]["supportTurns"], 90);
    }
    Ok(())
}
