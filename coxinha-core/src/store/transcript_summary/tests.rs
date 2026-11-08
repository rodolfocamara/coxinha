use super::*;
use crate::{jobs::JobInput, processing::ProcessingResult};
use rusqlite::{params, types::Value as SqlValue};
use serde_json::{json, Value};

fn result(text: Option<&str>) -> Value {
    let segments = text.map(|text| {
        json!({
            "id":"public-segment", "track":"mic", "start_ms":0, "end_ms":1,
            "text":text, "speaker":null
        })
    });
    json!({"segments":segments.into_iter().collect::<Vec<_>>(),"turns":[],"warnings":[]})
}

// Inject durable synthetic rows without invoking capture, models or inference.
fn persist(store: &Store, meeting: &str, state: &str, payload: Option<SqlValue>) -> String {
    let job = store
        .enqueue(
            meeting,
            "local-processing",
            &JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: uuid::Uuid::new_v4().to_string(),
            },
        )
        .unwrap();
    store
        .db
        .execute("UPDATE job SET state=?2 WHERE id=?1", params![job, state])
        .unwrap();
    if let Some(payload) = payload {
        store
            .db
            .execute(
                "INSERT INTO processing_run(job_id,config_json,result_json) VALUES(?1,'{}',?2)",
                params![job, payload],
            )
            .unwrap();
    }
    job
}
fn public(value: Value) -> Option<SqlValue> {
    Some(SqlValue::Text(value.to_string()))
}
fn assert_status(store: &Store, meeting: &str, expected: TranscriptStatus) {
    assert_eq!(store.meeting_transcript_status(meeting).unwrap(), expected);
    assert_eq!(
        store
            .meeting_transcript_statuses()
            .unwrap()
            .get(meeting)
            .copied()
            .unwrap_or_default(),
        expected
    );
}

#[test]
fn absence_and_generic_success_are_not_transcripts() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let meeting = store.create_meeting("No inference").unwrap();
    assert_status(&store, &meeting, TranscriptStatus::None);
    persist(&store, &meeting, "succeeded", None);
    assert_status(&store, &meeting, TranscriptStatus::None);
    assert!(store.meeting_transcript_statuses().unwrap().is_empty());
    assert_status(&store, "unknown-meeting", TranscriptStatus::None);
}

#[test]
fn newest_success_matches_report_even_with_later_failed_running_or_generic_jobs() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let meeting = store.create_meeting("Public transcript").unwrap();
    let job = persist(
        &store,
        &meeting,
        "succeeded",
        public(result(Some("Public text"))),
    );
    for state in ["failed", "running", "pending"] {
        persist(&store, &meeting, state, public(result(None)));
        assert_status(&store, &meeting, TranscriptStatus::Available);
        assert_eq!(store.processing_report(&meeting).unwrap().job, job);
    }
    persist(&store, &meeting, "succeeded", None);
    assert_status(&store, &meeting, TranscriptStatus::Available);
    let empty = persist(&store, &meeting, "succeeded", public(result(None)));
    assert_status(&store, &meeting, TranscriptStatus::Empty);
    assert_eq!(store.processing_report(&meeting).unwrap().job, empty);
    assert!(store
        .processing_report(&meeting)
        .unwrap()
        .segments
        .is_empty());
    persist(
        &store,
        &meeting,
        "succeeded",
        Some(SqlValue::Text("broken".into())),
    );
    assert_status(&store, &meeting, TranscriptStatus::Unavailable);
    assert!(store.processing_report(&meeting).is_err());
}

#[test]
fn empty_output_includes_whitespace_and_turns_without_transcript_text() {
    let mut turns_only = result(None);
    turns_only["turns"] =
        json!([{"id":"turn","track":"mic","start_ms":0,"end_ms":1,"speaker":"speaker-0"}]);
    for value in [
        result(None),
        result(Some("")),
        result(Some(" \n\t\u{2003}")),
        turns_only,
    ] {
        assert!(serde_json::from_value::<ProcessingResult>(value.clone()).is_ok());
        assert_eq!(
            summarize(value.to_string().as_bytes()),
            TranscriptStatus::Empty
        );
    }
    assert_eq!(
        summarize(result(Some("Olá\n世界")).to_string().as_bytes()),
        TranscriptStatus::Available
    );
}

#[test]
fn malformed_json_and_required_types_are_unavailable_not_partial_text() {
    let mut cases = vec![json!(null), json!([]), json!({}), json!({"segments":[]})];
    for field in ["segments", "turns", "warnings"] {
        for wrong in [
            json!(null),
            json!(true),
            json!(42),
            json!("text"),
            json!({}),
        ] {
            let mut value = result(Some("Earlier valid text"));
            value[field] = wrong;
            cases.push(value);
        }
        let mut value = result(Some("Earlier valid text"));
        value.as_object_mut().unwrap().remove(field);
        cases.push(value);
    }
    for field in ["id", "track", "start_ms", "end_ms", "text", "speaker"] {
        let mut value = result(Some("Valid first segment"));
        let mut bad = value["segments"][0].clone();
        bad[field] = json!({"invalid":"type"});
        value["segments"].as_array_mut().unwrap().push(bad);
        cases.push(value);
    }
    for bad in [
        json!(null),
        json!(false),
        json!("not a segment"),
        json!({"text":"only text"}),
    ] {
        let mut value = result(Some("Valid first segment"));
        value["segments"].as_array_mut().unwrap().push(bad);
        cases.push(value);
    }
    for time in [json!(-1), json!(0.5), json!("0")] {
        let mut value = result(Some("Invalid interval type"));
        value["segments"][0]["start_ms"] = time;
        cases.push(value);
    }
    for (field, bad) in [
        ("turns", json!([{"speaker":5}])),
        ("warnings", json!([5])),
        ("warnings", json!([null])),
    ] {
        let mut value = result(Some("Valid transcript"));
        value[field] = bad;
        cases.push(value);
    }
    for value in cases {
        assert!(
            serde_json::from_value::<ProcessingResult>(value.clone()).is_err(),
            "{value}"
        );
        assert_eq!(
            summarize(value.to_string().as_bytes()),
            TranscriptStatus::Unavailable,
            "{value}"
        );
    }
    for raw in [
        b"{bad".as_slice(),
        b"{\"segments\":[],\"segments\":[],\"turns\":[],\"warnings\":[]}",
        b"{\"segments\":[],\"turns\":[],\"warnings\":[]} trailing",
        b"\xff",
    ] {
        assert_eq!(summarize(raw), TranscriptStatus::Unavailable);
    }
}

#[test]
fn corrupt_rows_are_isolated_and_summary_never_reads_raw_or_private_profiles() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let healthy = store.create_meeting("Healthy").unwrap();
    persist(
        &store,
        &healthy,
        "succeeded",
        public(result(Some("Public transcript"))),
    );
    let mut corrupt = Vec::new();
    for payload in [
        SqlValue::Null,
        SqlValue::Blob(b"{}".to_vec()),
        SqlValue::Text("malformed".into()),
        SqlValue::Text("{}".into()),
    ] {
        let meeting = store.create_meeting("Corrupt row").unwrap();
        persist(&store, &meeting, "succeeded", Some(payload));
        corrupt.push(meeting);
    }
    std::fs::remove_dir_all(dir.path().join("raw")).unwrap();
    store
        .profiles
        .execute_batch("DROP TABLE person; DROP TABLE assignment;")
        .unwrap();
    let changes = store.db.total_changes();
    let version: u32 = store
        .db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    let batch = store.meeting_transcript_statuses().unwrap();
    assert_eq!(batch.len(), 1 + corrupt.len());
    assert_eq!(batch[&healthy], TranscriptStatus::Available);
    for meeting in corrupt {
        assert_status(&store, &meeting, TranscriptStatus::Unavailable);
    }
    assert_status(&store, &healthy, TranscriptStatus::Available);
    assert_eq!(store.db.total_changes(), changes);
    assert_eq!(
        store
            .db
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        version
    );
}

#[test]
fn selection_uses_successful_run_order_not_uuid_or_stage_or_completion_time() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let meeting = store.create_meeting("Order").unwrap();
    let earlier = persist(&store, &meeting, "running", public(result(Some("Old row"))));
    let latest = persist(&store, &meeting, "succeeded", public(result(None)));
    // A historical row completing later must not change processing_report's order.
    // The report selector intentionally has no stage predicate.
    store
        .db
        .execute("UPDATE job SET state='succeeded' WHERE id=?1", [earlier])
        .unwrap();
    store
        .db
        .execute(
            "UPDATE job SET stage='historical-stage' WHERE id=?1",
            [&latest],
        )
        .unwrap();
    assert_eq!(store.processing_report(&meeting).unwrap().job, latest);
    assert_status(&store, &meeting, TranscriptStatus::Empty);
}

#[test]
fn database_failure_is_not_silently_reported_as_none() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    store
        .db
        .execute_batch("DROP TABLE processing_run;")
        .unwrap();
    assert!(store.meeting_transcript_statuses().is_err());
    assert!(store.meeting_transcript_status("missing").is_err());
}
