use super::*;
use coxinha_core::jobs::JobInput;

fn result(texts: &[&str]) -> String {
    let segments: Vec<Value> = texts
        .iter()
        .enumerate()
        .map(|(i, text)| {
            json!({"id": format!("s{i}"), "track": "mic", "start_ms": i as u64 * 1000,
                   "end_ms": i as u64 * 1000 + 900, "text": text, "speaker": null})
        })
        .collect();
    json!({"segments": segments, "turns": [], "warnings": []}).to_string()
}

/// Durable rows of a successful run, written the way the processing commit does.
fn succeeded(root: &std::path::Path, meeting: &str, texts: &[&str]) -> String {
    let store = Store::open(root).unwrap();
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
    drop(store);
    let db = rusqlite::Connection::open(root.join("meetings.db")).unwrap();
    db.execute("UPDATE job SET state='succeeded' WHERE id=?1", [&job])
        .unwrap();
    db.execute(
        "INSERT INTO processing_run(job_id,config_json,result_json) VALUES(?1,'{}',?2)",
        rusqlite::params![job, result(texts)],
    )
    .unwrap();
    job
}

fn meeting(root: &std::path::Path, title: &str) -> String {
    Store::open(root).unwrap().create_meeting(title).unwrap()
}

#[tokio::test]
async fn the_queue_offers_new_transcripts_skips_silence_and_keeps_same_words() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let spoken = meeting(root, "spoken");
    let silent = meeting(root, "silent");
    let first = succeeded(root, &spoken, &["Fechamos a meta.", "Ana revisa o SLA."]);
    succeeded(root, &silent, &["  "]);
    let library = Library::open(root.into(), None).unwrap();

    let source = library.next_summary_source(vec![]).await.unwrap().unwrap();
    assert_eq!(source.meeting_id, spoken);
    assert_eq!(source.job_id, first);
    assert_eq!(
        source.lines,
        vec![
            (0, "mic".to_string(), "Fechamos a meta.".to_string()),
            (1000, "mic".to_string(), "Ana revisa o SLA.".to_string()),
        ]
    );
    assert!(library
        .next_summary_source(vec![spoken.clone()])
        .await
        .unwrap()
        .is_none());
    assert_eq!(library.summary(spoken.clone()).await.unwrap(), None);

    library
        .save_summary(StoredSummaryInput {
            meeting_id: spoken.clone(),
            job_id: first,
            markdown: "## Resumo\nMeta.".into(),
            model: "qwen".into(),
            generated_at: "2026-11-03T10:00:00Z".into(),
            source_sha256: source.source_sha256.clone(),
        })
        .await
        .unwrap();
    assert_eq!(
        library.summary(spoken.clone()).await.unwrap(),
        Some(MeetingSummary {
            markdown: "## Resumo\nMeta.".into(),
            generated_at: "2026-11-03T10:00:00Z".into()
        })
    );
    assert!(library.next_summary_source(vec![]).await.unwrap().is_none());
    library.shutdown().await.unwrap();

    // A rerun with the same words keeps the summary; new words queue it again.
    succeeded(root, &spoken, &["Fechamos a meta.", "Ana revisa o SLA."]);
    let library = Library::open(root.into(), None).unwrap();
    assert!(library.next_summary_source(vec![]).await.unwrap().is_none());
    library.shutdown().await.unwrap();
    let newer = succeeded(root, &spoken, &["Fechamos a meta de 99,5%."]);
    let library = Library::open(root.into(), None).unwrap();
    let again = library.next_summary_source(vec![]).await.unwrap().unwrap();
    assert_eq!(again.job_id, newer);
    assert_ne!(again.source_sha256, source.source_sha256);
    assert!(library.summary_source(silent).await.is_err());
    library.shutdown().await.unwrap();
}
