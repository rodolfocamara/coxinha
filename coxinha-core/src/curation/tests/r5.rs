use super::*;
use crate::curation::{
    preparation_budget::ReadBudget,
    report_collections::{capacity_bytes, count as numeric_count},
    CurationError,
};
use serde::de::DeserializeOwned;

fn check_capacity<T: DeserializeOwned + Clone>(element: &str) -> Result<()> {
    for k in 1..=12 {
        for n in [(1 << k) - 1, 1 << k, (1 << k) + 1] {
            let raw = format!("[{}]", vec![element; n].join(","));
            let items: Vec<T> = serde_json::from_str(&raw)?;
            let bound = capacity_bytes::<T>(n)?;
            assert_eq!(items.len(), n);
            assert!(items.capacity() * std::mem::size_of::<T>() <= bound);
            let copy = items.clone();
            assert!(copy.capacity() * std::mem::size_of::<T>() <= bound);
        }
    }
    Ok(())
}
#[test]
fn all_deserialized_report_vec_types_fit_typed_capacity_bound_at_power_boundaries() -> Result<()> {
    check_capacity::<String>("\"\"")?;
    check_capacity::<f32>("0")?;
    check_capacity::<crate::processing::TranscriptSegment>(
        r#"{"id":"","track":"","start_ms":0,"end_ms":1,"text":"","speaker":null}"#,
    )?;
    check_capacity::<SpeakerTurn>(
        r#"{"id":"","track":"","start_ms":0,"end_ms":1,"speaker":"","embedding":null,"space":null}"#,
    )?;
    // Candidate has a larger inline layout than SpeakerTurn. Its cloned-turn
    // Vec must have its own typed bound rather than reuse the source element size.
    for k in 1..=12 {
        for n in [(1 << k) - 1, 1 << k, (1 << k) + 1] {
            let mut items = Vec::new();
            for _ in 0..n {
                items.push(crate::curation::Candidate {
                    turn: result().turns[0].clone(),
                    space: None,
                    vector: vec![],
                    provenance: None,
                    reasons: vec![],
                    active_count: 0,
                });
            }
            assert!(
                items.capacity() * std::mem::size_of::<crate::curation::Candidate>()
                    <= capacity_bytes::<crate::curation::Candidate>(n)?
            );
        }
    }
    assert_eq!(capacity_bytes::<String>(0)?, 0);
    Ok(())
}
#[test]
fn null_negative_count_rounding_and_size_overflow_fail_capacity() -> Result<()> {
    assert_eq!(numeric_count(Some(0))?, 0);
    assert_eq!(numeric_count(Some(7))?, 7);
    for n in [None, Some(-1)] {
        assert_eq!(
            numeric_count(n).unwrap_err().to_string(),
            CurationError::Capacity.to_string()
        );
    }
    for n in [usize::MAX, 1usize << (usize::BITS - 2)] {
        assert_eq!(
            capacity_bytes::<String>(n).unwrap_err().to_string(),
            CurationError::Capacity.to_string()
        );
    }
    assert!(ReadBudget::default()
        .charge(capacity_bytes::<String>(1 << 22)?, 2)
        .is_err());
    Ok(())
}
fn replace_report(store: &Store, job: &str, report: &Value) -> Result<()> {
    store.db.execute(
        "UPDATE processing_run SET result_json=?1 WHERE job_id=?2",
        params![serde_json::to_string(report)?, job],
    )?;
    Ok(())
}
fn stored_report(store: &Store, job: &str) -> Result<Value> {
    let raw: String = store.db.query_row(
        "SELECT result_json FROM processing_run WHERE job_id=?1",
        [job],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&raw)?)
}
#[test]
fn reasonable_warnings_are_kept_in_full_with_frozen_v1_equivalence_and_no_writes() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    let mut raw = stored_report(&store, &s.job)?;
    let mut warnings = vec![""; 4097];
    warnings[0] = "first";
    warnings[4096] = "last";
    raw["warnings"] = json!(warnings);
    replace_report(&store, &s.job, &raw)?;
    let before = (store.db.total_changes(), store.profiles.total_changes());
    assert_eq!(
        store.voice_comparison(&s.job)?,
        store.voice_comparison_v1_reference(&s.job)?
    );
    let report = store.processing_report_by_job(&s.job)?;
    assert_eq!(report.warnings.len(), 4097);
    assert_eq!(report.warnings[0], "first");
    assert_eq!(report.warnings[4096], "last");
    assert_eq!(
        before,
        (store.db.total_changes(), store.profiles.total_changes())
    );
    Ok(())
}
#[test]
fn warning_capacity_jump_refuses_both_extreme_counts_without_mutation() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    let raw: String = store.db.query_row(
        "SELECT result_json FROM processing_run WHERE job_id=?1",
        [&s.job],
        |r| r.get(0),
    )?;
    for n in [(1 << 22), (1 << 22) + 1] {
        let warnings = format!("\"warnings\":[{}\"\"]", "\"\",".repeat(n - 1));
        let replaced = raw.replace("\"warnings\":[]", &warnings);
        store.db.execute(
            "UPDATE processing_run SET result_json=?1 WHERE job_id=?2",
            params![replaced, s.job],
        )?;
        let before = (store.db.total_changes(), store.profiles.total_changes());
        assert_eq!(
            store.voice_comparison(&s.job).unwrap_err().to_string(),
            CurationError::Capacity.to_string()
        );
        assert_eq!(
            before,
            (store.db.total_changes(), store.profiles.total_changes())
        );
        let retained: i64 = store.db.query_row("SELECT json_array_length(result_json,'$.warnings') FROM processing_run WHERE job_id=?1", [&s.job], |r| r.get(0))?;
        assert_eq!(retained, n as i64);
    }
    Ok(())
}
#[test]
fn required_arrays_and_optional_embedding_count_fail_closed_without_value_loading() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let original = stored_report(&store, &s.job)?;
    for field in ["segments", "turns", "warnings"] {
        for invalid in [Value::Null, json!({}), json!(1)] {
            let mut raw = original.clone();
            raw[field] = invalid;
            replace_report(&store, &s.job, &raw)?;
            assert_eq!(
                store.voice_comparison(&s.job).unwrap_err().to_string(),
                CurationError::Capacity.to_string()
            );
        }
    }
    for value in [Value::Null, json!([1., 0.])] {
        let mut raw = original.clone();
        raw["turns"][0]["embedding"] = value;
        replace_report(&store, &s.job, &raw)?;
        assert_eq!(
            store.voice_comparison(&s.job)?,
            store.voice_comparison_v1_reference(&s.job)?
        );
    }
    let mut raw = original;
    raw["turns"][0]["embedding"] = json!({});
    replace_report(&store, &s.job, &raw)?;
    assert_eq!(
        store.voice_comparison(&s.job).unwrap_err().to_string(),
        CurationError::Capacity.to_string()
    );
    Ok(())
}

#[test]
fn embedding_capacity_is_summed_across_every_turn_before_materialization() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let original = stored_report(&store, &s.job)?;
    let values = format!("[{}0]", "0,".repeat((1 << 21) - 1));
    for n in 1..=3 {
        let mut raw = original.clone();
        let mut turn = raw["turns"][0].clone();
        turn["embedding"] = json!([]);
        raw["turns"] = json!(vec![turn; n]);
        let text = serde_json::to_string(&raw)?
            .replace("\"embedding\":[]", &format!("\"embedding\":{values}"));
        store.db.execute(
            "UPDATE processing_run SET result_json=?1 WHERE job_id=?2",
            params![text, s.job],
        )?;
        let before = (store.db.total_changes(), store.profiles.total_changes());
        let admitted = crate::curation::preparation_budget::admit_report(&store, &s.job);
        if n < 3 {
            admitted?;
        } else {
            assert_eq!(
                admitted.unwrap_err().to_string(),
                CurationError::Capacity.to_string()
            );
        }
        assert_eq!(
            before,
            (store.db.total_changes(), store.profiles.total_changes())
        );
        let retained: i64 = store.db.query_row(
            "SELECT json_array_length(result_json,'$.turns') FROM processing_run WHERE job_id=?1",
            [&s.job],
            |r| r.get(0),
        )?;
        assert_eq!(retained, n as i64);
    }
    Ok(())
}
