use super::*;
use crate::jobs::JobInput;
use rusqlite::params;

fn succeeded(store: &Store, meeting: &str) -> String {
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
        .execute("UPDATE job SET state='succeeded' WHERE id=?1", [&job])
        .unwrap();
    store
        .db
        .execute(
            "INSERT INTO processing_run(job_id,config_json,result_json) VALUES(?1,'{}',?2)",
            params![job, r#"{"segments":[],"turns":[],"warnings":[]}"#],
        )
        .unwrap();
    job
}

fn stored(meeting: &str, job: &str, sha: &str) -> StoredSummary {
    StoredSummary {
        meeting_id: meeting.into(),
        job_id: job.into(),
        markdown: "## Resumo\nOk.".into(),
        model: "qwen".into(),
        generated_at: "2026-11-03T10:00:00Z".into(),
        source_sha256: sha.into(),
    }
}

#[test]
fn a_successful_transcript_queues_a_summary_until_one_exists() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let old = store.create_meeting("old").unwrap();
    let new = store.create_meeting("new").unwrap();
    let pending = store.create_meeting("not processed").unwrap();
    let old_job = succeeded(&store, &old);
    let new_job = succeeded(&store, &new);
    let _ = pending;
    assert_eq!(
        store.summary_candidates().unwrap(),
        vec![
            (new.clone(), new_job.clone()),
            (old.clone(), old_job.clone())
        ]
    );

    store
        .save_meeting_summary(&stored(&old, &old_job, "h1"))
        .unwrap();
    assert_eq!(
        store.summary_candidates().unwrap(),
        vec![(new.clone(), new_job)]
    );
    assert_eq!(
        store.meeting_summary_record(&old).unwrap().unwrap().job_id,
        old_job
    );
}

#[test]
fn a_newer_transcript_makes_the_summary_stale_and_a_retag_keeps_it() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let meeting = store.create_meeting("m").unwrap();
    let first = succeeded(&store, &meeting);
    store
        .save_meeting_summary(&stored(&meeting, &first, "h1"))
        .unwrap();
    assert!(store.summary_candidates().unwrap().is_empty());

    let second = succeeded(&store, &meeting);
    assert_eq!(
        store.summary_candidates().unwrap(),
        vec![(meeting.clone(), second.clone())]
    );
    store.retag_meeting_summary(&meeting, &second).unwrap();
    assert!(store.summary_candidates().unwrap().is_empty());

    let mut rewritten = stored(&meeting, &second, "h2");
    rewritten.markdown = "## Resumo\nNovo.".into();
    store.save_meeting_summary(&rewritten).unwrap();
    assert_eq!(
        store.meeting_summary_record(&meeting).unwrap(),
        Some(rewritten)
    );
}

#[test]
fn readers_without_the_table_see_no_summary() {
    let db = Connection::open_in_memory().unwrap();
    assert_eq!(read_summary(&db, "m").unwrap(), None);
}

#[test]
fn a_version_five_library_gains_the_table() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let meeting = store.create_meeting("m").unwrap();
    store
        .db
        .execute_batch("DROP TABLE meeting_summary")
        .unwrap();
    store.db.pragma_update(None, "user_version", 5).unwrap();
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    let job = succeeded(&store, &meeting);
    store
        .save_meeting_summary(&stored(&meeting, &job, "h"))
        .unwrap();
    let version: i64 = store
        .db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 6);
}
