use super::*;
use crate::curation::{
    preparation_budget::{aggregate, checked_aggregate, ReadBudget},
    CurationError,
};

#[test]
fn auxiliary_rowid_never_decodes_or_rewrites_sample_identity() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    store.enroll_selected_turns(&s)?;
    // A non-UTF8 persisted identity catches an accidental String lookup without
    // requiring a test-global allocator; the exact 129 MiB probe runs separately.
    let id = vec![255u8; 2048];
    store
        .profiles
        .execute("UPDATE voice_sample SET id=?1", [&id])?;
    let before = store.profiles.total_changes();
    assert_eq!(
        store.voice_comparison(&s.job)?["speakers"][0]["spaces"][0]["status"],
        "self_excluded"
    );
    store
        .profiles
        .execute("UPDATE voice_sample SET vector_json='not-vector-json'", [])?;
    assert_eq!(
        store.voice_comparison(&s.job)?,
        store.voice_comparison_v1_reference(&s.job)?
    );
    let retained: Vec<u8> = store
        .profiles
        .query_row("SELECT id FROM voice_sample", [], |r| r.get(0))?;
    assert_eq!(retained, id);
    assert_eq!(store.profiles.total_changes(), before + 1);
    Ok(())
}
#[test]
fn numeric_preflight_covers_utf8_space_metadata_and_candidate_id_label() -> Result<()> {
    for field in ["model", "turn_id", "speaker"] {
        let (_d, store, _, _, s) = fixture()?;
        store.enroll_selected_turns(&s)?;
        match field {
            "model" => {
                store.profiles.execute(
                    "UPDATE embedding_space SET model=?1",
                    ["é".repeat(5 * 1024 * 1024)],
                )?;
            }
            "turn_id" => {
                store.profiles.execute(
                    "UPDATE processed_candidate SET turn_id=?1",
                    ["t".repeat(23 * 1024 * 1024)],
                )?;
            }
            "speaker" => {
                store.profiles.execute(
                    "UPDATE processed_candidate SET speaker=?1",
                    ["s".repeat(23 * 1024 * 1024)],
                )?;
            }
            _ => unreachable!(),
        }
        assert_eq!(
            store.voice_comparison(&s.job).unwrap_err().to_string(),
            CurationError::Capacity.to_string()
        );
    }
    Ok(())
}
#[test]
fn aggregate_null_invalid_numeric_and_arithmetic_overflow_fail_closed() -> Result<()> {
    assert_eq!(checked_aggregate(0, 0, None)?, (0, 0));
    assert_eq!(checked_aggregate(2, 2, Some(5))?, (2, 5));
    for (rows, values, sum) in [
        (1, 1, None),
        (2, 1, Some(0)),
        (0, 0, Some(1)),
        (-1, -1, None),
        (1, 1, Some(-1)),
    ] {
        assert_eq!(
            checked_aggregate(rows, values, sum)
                .unwrap_err()
                .to_string(),
            CurationError::Capacity.to_string()
        );
    }
    assert!(ReadBudget::default().charge(usize::MAX, 2).is_err());
    let db = rusqlite::Connection::open_in_memory()?;
    assert_eq!(
        aggregate(
            &db,
            "SELECT 2,2,sum(n) FROM (SELECT 9223372036854775807 AS n UNION ALL SELECT 1)",
            []
        )
        .unwrap_err()
        .to_string(),
        CurationError::Capacity.to_string()
    );
    assert_eq!(
        aggregate(&db, "SELECT 1,1,NULL", [])
            .unwrap_err()
            .to_string(),
        CurationError::Capacity.to_string()
    );
    Ok(())
}
#[test]
fn only_latest_selected_segment_edits_are_charged_not_retained_history() -> Result<()> {
    let (_d, mut store, mut c, meeting, mut s) = fixture()?;
    let mut output = result();
    output.segments.push(crate::processing::TranscriptSegment {
        id: "segment".into(),
        track: "mic".into(),
        start_ms: 0,
        end_ms: 200,
        text: "synthetic".into(),
        speaker: Some("speaker-0".into()),
    });
    c.engine_version = "read-budget-edits".into();
    s.job = process(&mut store, &meeting, &c, output)?;
    s.assignment_id = store.confirm_processed_track_speaker(
        &s.job,
        &s.speaker,
        Some(&s.track),
        &s.person_id,
        "synthetic",
    )?;
    store.enroll_selected_turns(&s)?;
    let target = format!("{}:segment", s.job);
    let retained = "h".repeat(70 * 1024 * 1024);
    store.edit(&meeting, &target, &retained)?;
    store.edit(&meeting, &target, "latest")?;
    store.edit(&meeting, &format!("{}:absent", s.job), &retained)?;
    let before = store.db.total_changes();
    let size_before: (i64, i64) = store.db.query_row(
        "SELECT count(*),sum(length(CAST(body AS BLOB))) FROM human_edit",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    assert!(size_before.1 > 128 * 1024 * 1024);
    assert_eq!(
        store.voice_comparison(&s.job)?["speakers"][0]["spaces"][0]["status"],
        "self_excluded"
    );
    assert_eq!(
        store.processing_report_by_job(&s.job)?.corrections["segment"],
        "latest"
    );
    assert_eq!(store.db.total_changes(), before);
    let size_after: (i64, i64) = store.db.query_row(
        "SELECT count(*),sum(length(CAST(body AS BLOB))) FROM human_edit",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    assert_eq!(size_before, size_after);
    store.edit(&meeting, &target, &retained)?;
    assert_eq!(
        store.voice_comparison(&s.job).unwrap_err().to_string(),
        CurationError::Capacity.to_string()
    );
    Ok(())
}

#[test]
fn report_preflight_counts_utf8_bytes_before_the_legacy_character_limit() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let raw: String = store.db.query_row(
        "SELECT result_json FROM processing_run WHERE job_id=?1",
        [&s.job],
        |r| r.get(0),
    )?;
    let mut report: Value = serde_json::from_str(&raw)?;
    report["turns"][0]["speaker"] = json!("🦀".repeat(5 * 1024 * 1024));
    store.db.execute(
        "UPDATE processing_run SET result_json=?1 WHERE job_id=?2",
        params![serde_json::to_string(&report)?, s.job],
    )?;
    assert_eq!(
        store.voice_comparison(&s.job).unwrap_err().to_string(),
        CurationError::Capacity.to_string()
    );
    Ok(())
}
