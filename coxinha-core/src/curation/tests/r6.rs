use super::*;
use crate::curation::{preparation_budget, CurationError};

pub(super) fn stored(store: &Store, job: &str) -> Result<Value> {
    let raw: String = store.db.query_row(
        "SELECT result_json FROM processing_run WHERE job_id=?1",
        [job],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&raw)?)
}
pub(super) fn persist(store: &Store, job: &str, v: &Value) -> Result<()> {
    store.db.execute(
        "UPDATE processing_run SET result_json=?1 WHERE job_id=?2",
        params![serde_json::to_string(v)?, job],
    )?;
    Ok(())
}
pub(super) fn represent(original: &Value, outer: bool, mode: u8) -> Value {
    let mut v = original.clone();
    for (i, s) in v["segments"].as_array_mut().unwrap().iter_mut().enumerate() {
        if mode == 1 || (mode == 2 && i % 2 == 0) {
            *s = json!([
                s["id"],
                s["track"],
                s["start_ms"],
                s["end_ms"],
                s["text"],
                s["speaker"]
            ]);
        }
    }
    for (i, t) in v["turns"].as_array_mut().unwrap().iter_mut().enumerate() {
        if mode == 1 || (mode == 2 && i % 2 == 0) {
            *t = json!([
                t["id"],
                t["track"],
                t["start_ms"],
                t["end_ms"],
                t["speaker"],
                t["embedding"],
                t["space"]
            ]);
        }
    }
    if outer {
        json!([v["segments"], v["turns"], v["warnings"]])
    } else {
        v
    }
}
fn add_segments(output: &mut ProcessingResult) {
    for id in ["quote\"\\é🦀", "line\n\t", "prefix\0suffix", "\u{0001}tail"] {
        output.segments.push(crate::processing::TranscriptSegment {
            id: id.into(),
            track: "mic".into(),
            start_ms: 0,
            end_ms: 200,
            text: "synthetic".into(),
            speaker: None,
        });
    }
}
#[test]
fn reader_equivalence_for_object_positional_mixed_report_and_job_input() -> Result<()> {
    let (_d, mut store, mut config, meeting, _) = fixture()?;
    let mut output = result();
    add_segments(&mut output);
    output.warnings = vec!["first".into(), "".into(), "é\nlast".into()];
    config.engine_version = "r6-representations".into();
    let job = process(&mut store, &meeting, &config, output)?;
    let original = stored(&store, &job)?;
    for segment in original["segments"].as_array().unwrap() {
        let id = segment["id"].as_str().unwrap();
        store.edit(&meeting, &format!("{job}:{id}"), "older")?;
        store.edit(&meeting, &format!("{job}:{id}"), &format!("latest:{id}"))?;
    }
    store.edit(&meeting, &format!("{job}:absent"), "unselected")?;
    let expected = store.processing_report_by_job(&job)?;
    let comparison = store.voice_comparison(&job)?;
    let raw: String =
        store
            .db
            .query_row("SELECT input_json FROM job WHERE id=?1", [&job], |r| {
                r.get(0)
            })?;
    let input: Value = serde_json::from_str(&raw)?;
    for outer in [false, true] {
        for mode in 0..=2 {
            let value = represent(&original, outer, mode);
            let typed: ProcessingResult = serde_json::from_value(value.clone())?;
            assert_eq!(serde_json::to_value(&typed)?, original);
            persist(&store, &job, &value)?;
            let input = if mode == 1 {
                json!([
                    input["artifact_sha256"],
                    input["config_sha256"],
                    input["model_sha256"],
                    input["engine_version"]
                ])
            } else {
                input.clone()
            };
            let _: crate::jobs::JobInput = serde_json::from_value(input.clone())?;
            store.db.execute(
                "UPDATE job SET input_json=?1 WHERE id=?2",
                params![serde_json::to_string(&input)?, job],
            )?;
            let before = (store.db.total_changes(), store.profiles.total_changes());
            let report = store.processing_report_by_job(&job)?;
            assert_eq!(report.corrections, expected.corrections);
            assert_eq!(report.warnings, expected.warnings);
            assert_eq!(store.voice_comparison(&job)?, comparison);
            assert_eq!(
                store.voice_comparison(&job)?,
                store.voice_comparison_v1_reference(&job)?
            );
            assert_eq!(
                before,
                (store.db.total_changes(), store.profiles.total_changes())
            );
        }
    }
    Ok(())
}
#[test]
fn selected_latest_edits_are_cumulative_for_every_representation() -> Result<()> {
    let (_d, mut store, mut config, meeting, _) = fixture()?;
    let mut output = result();
    add_segments(&mut output);
    config.engine_version = "r6-cumulative".into();
    let job = process(&mut store, &meeting, &config, output)?;
    let original = stored(&store, &job)?;
    let target = format!("{job}:{}", original["segments"][0]["id"].as_str().unwrap());
    store.edit(&meeting, &target, &"e".repeat(30 * 1024 * 1024))?;
    let raw: String =
        store
            .db
            .query_row("SELECT input_json FROM job WHERE id=?1", [&job], |r| {
                r.get(0)
            })?;
    let mut input: Value = serde_json::from_str(&raw)?;
    input["engine_version"] = json!("é".repeat(20 * 1024 * 1024));
    store.db.execute(
        "UPDATE job SET input_json=?1 WHERE id=?2",
        params![serde_json::to_string(&input)?, job],
    )?;
    drop(input);
    for outer in [false, true] {
        for mode in 0..=2 {
            persist(&store, &job, &represent(&original, outer, mode))?;
            let before = (store.db.total_changes(), store.profiles.total_changes());
            assert_eq!(
                store.voice_comparison(&job).unwrap_err().to_string(),
                CurationError::Capacity.to_string()
            );
            assert_eq!(
                before,
                (store.db.total_changes(), store.profiles.total_changes())
            );
        }
    }
    // Once superseded, the retained large edit must cease gating this report.
    store.edit(&meeting, &target, "latest")?;
    for outer in [false, true] {
        persist(&store, &job, &represent(&original, outer, 2))?;
        assert_eq!(
            store.voice_comparison(&job)?,
            store.voice_comparison_v1_reference(&job)?
        );
        assert_eq!(
            store
                .processing_report_by_job(&job)?
                .corrections
                .values()
                .next()
                .unwrap(),
            "latest"
        );
    }
    Ok(())
}
#[test]
fn positional_optional_embeddings_and_required_arrays_keep_reader_semantics() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let original = stored(&store, &s.job)?;
    for outer in [false, true] {
        for mode in [0, 1] {
            for embedding in [Value::Null, json!([1., 0.]), json!({}), json!(1)] {
                let mut v = original.clone();
                v["turns"][0]["embedding"] = embedding.clone();
                let value = represent(&v, outer, mode);
                persist(&store, &s.job, &value)?;
                if embedding.is_null() || embedding.is_array() {
                    let _: ProcessingResult = serde_json::from_value(value)?;
                    assert_eq!(
                        store.voice_comparison(&s.job)?,
                        store.voice_comparison_v1_reference(&s.job)?
                    );
                } else {
                    assert_eq!(
                        store.voice_comparison(&s.job).unwrap_err().to_string(),
                        CurationError::Capacity.to_string()
                    );
                }
            }
            for (index, field) in ["segments", "turns", "warnings"].iter().enumerate() {
                for invalid in [Value::Null, json!({}), json!("[]")] {
                    let mut value = represent(&original, outer, mode);
                    if outer {
                        value[index] = invalid;
                    } else {
                        value[*field] = invalid;
                    }
                    persist(&store, &s.job, &value)?;
                    assert_eq!(
                        store.voice_comparison(&s.job).unwrap_err().to_string(),
                        CurationError::Capacity.to_string()
                    );
                }
            }
        }
    }
    // The unchanged derived reader owns positional field-count validation.
    for len in 0..=8 {
        let mut value = represent(&original, false, 1);
        let turn = value["turns"][0].as_array_mut().unwrap();
        turn.resize(len, Value::Null);
        let typed = serde_json::from_value::<ProcessingResult>(value.clone());
        persist(&store, &s.job, &value)?;
        if typed.is_ok() {
            assert_eq!(
                store.voice_comparison(&s.job)?,
                store.voice_comparison_v1_reference(&s.job)?
            );
        } else {
            assert!(store.voice_comparison(&s.job).is_err());
        }
    }
    Ok(())
}
#[test]
fn positional_embedding_capacity_sums_all_turns_at_power_boundary() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let original = stored(&store, &s.job)?;
    for size in [(1 << 21) - 1, 1 << 21, (1 << 21) + 1] {
        let embedding = format!("[{}0]", "0,".repeat(size - 1));
        for outer in [false, true] {
            for n in 1..=3 {
                let mut v = original.clone();
                v["turns"][0]["embedding"] = json!("EMBEDDING");
                v["turns"] = json!(vec![v["turns"][0].clone(); n]);
                let value = represent(&v, outer, 2);
                let text = serde_json::to_string(&value)?.replace("\"EMBEDDING\"", &embedding);
                store.db.execute(
                    "UPDATE processing_run SET result_json=?1 WHERE job_id=?2",
                    params![text, s.job],
                )?;
                let before = (store.db.total_changes(), store.profiles.total_changes());
                let admission = preparation_budget::admit_report(&store, &s.job);
                if n == 3 || (size > 1 << 21 && n == 2) {
                    assert_eq!(
                        admission.unwrap_err().to_string(),
                        CurationError::Capacity.to_string()
                    );
                } else {
                    admission?;
                }
                assert_eq!(
                    before,
                    (store.db.total_changes(), store.profiles.total_changes())
                );
            }
        }
    }
    Ok(())
}
#[test]
fn positional_private_provenance_still_blocks_duplicate_before_sql_fallback() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    let raw: String =
        store
            .profiles
            .query_row("SELECT provenance_json FROM voice_sample", [], |r| r.get(0))?;
    let p: Value = serde_json::from_str(&raw)?;
    let positional = json!([
        p["meeting"],
        p["track"],
        p["start_ms"],
        p["end_ms"],
        p["audio_sha256"],
        p["device"],
        p["quality_note"]
    ]);
    let _: SampleProvenance = serde_json::from_value(positional.clone())?;
    store.profiles.execute(
        "UPDATE voice_sample SET provenance_json=?1",
        [serde_json::to_string(&positional)?],
    )?;
    let before = store.profiles.total_changes();
    assert!(store
        .enroll_selected_turns(&s)
        .unwrap_err()
        .to_string()
        .contains("already_enrolled"));
    assert_eq!(store.profiles.total_changes(), before);
    Ok(())
}
