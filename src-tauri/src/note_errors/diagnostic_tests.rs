//! Diagnostic-only regressions; use production Storage with disposable Markdown.
use super::*;
use crate::{db::Db, storage::Storage};
use std::{path::Path, sync::Arc};
use tokio::fs;

async fn fixture() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["notes", "daily"] {
        fs::create_dir(dir.path().join(sub)).await.unwrap();
    }
    let storage = Storage::new(
        dir.path().into(),
        Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
    );
    (dir, storage)
}

fn first_line(message: &str) -> &str {
    message.lines().next().unwrap()
}

fn index_rows(dir: &Path) -> Vec<Vec<Vec<String>>> {
    let conn = rusqlite::Connection::open(dir.join("index.db")).unwrap();
    [
        "SELECT id,path,title,tags_json,created_at,updated_at FROM notes ORDER BY id",
        "SELECT id,title,body FROM notes_fts ORDER BY id,body",
        "SELECT source_id,target_text,target_lc FROM links ORDER BY source_id,target_text",
    ]
    .into_iter()
    .map(|sql| {
        let mut stmt = conn.prepare(sql).unwrap();
        let count = stmt.column_count();
        stmt.query_map([], |row| {
            (0..count).map(|i| row.get::<_, String>(i)).collect()
        })
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap()
    })
    .collect()
}

#[tokio::test]
async fn red_duplicate_rebuild_ipc_retains_both_paths_without_repeating_code_or_body() {
    let (dir, storage) = fixture().await;
    let note = storage
        .create_note("Original", "# PRIVATE_BODY [[Target]]")
        .await
        .unwrap();
    let original = fs::read(dir.path().join(&note.path)).await.unwrap();
    let duplicate_path = "notes/duplicate.md";
    fs::write(dir.path().join(duplicate_path), &original)
        .await
        .unwrap();
    let before = index_rows(dir.path());
    let message = ipc_error(storage.rebuild_from_vault().await.unwrap_err());
    assert_eq!(first_line(&message), "note_file_identity_conflict");
    assert!(message.contains(&note.path), "{message}");
    assert!(message.contains(duplicate_path), "{message}");
    assert_eq!(message.matches("note_file_identity_conflict").count(), 1);
    assert!(!message.contains("PRIVATE_BODY"));
    assert_eq!(index_rows(dir.path()), before);
    assert_eq!(
        fs::read(dir.path().join(&note.path)).await.unwrap(),
        original
    );
    assert_eq!(
        fs::read(dir.path().join(duplicate_path)).await.unwrap(),
        original
    );
}

#[tokio::test]
async fn red_malformed_rebuild_and_daily_ipc_identify_file_category_and_location_without_scalars() {
    for operation in ["rebuild", "daily"] {
        let (dir, storage) = fixture().await;
        storage
            .create_note("Retained", "# Old [[Target]]")
            .await
            .unwrap();
        let bad = format!("---\ncoxinha-note: 1\nid: {}\ncustom:\n  PRIVATE_KEY: PRIVATE_VALUE\n  PRIVATE_KEY: SECOND_SECRET\n---\n# PRIVATE_BODY", uuid::Uuid::new_v4());
        fs::write(dir.path().join("notes/bad.md"), &bad)
            .await
            .unwrap();
        fs::write(dir.path().join("daily/2026-10-24.md"), "# Daily")
            .await
            .unwrap();
        let before = index_rows(dir.path());
        let error = if operation == "rebuild" {
            storage.rebuild_from_vault().await.err().unwrap()
        } else {
            storage
                .get_or_create_daily_note(Some("2026-10-24"))
                .await
                .err()
                .unwrap()
        };
        let message = ipc_error(error);
        assert_eq!(first_line(&message), "note_file_invalid_metadata");
        for expected in ["notes/bad.md", "metadata", "line", "column"] {
            assert!(message.contains(expected), "{operation}: {message}");
        }
        for private in [
            "PRIVATE_KEY",
            "PRIVATE_VALUE",
            "SECOND_SECRET",
            "PRIVATE_BODY",
        ] {
            assert!(!message.contains(private), "{operation}: {message}");
        }
        assert_eq!(message.matches("note_file_invalid_metadata").count(), 1);
        assert_eq!(index_rows(dir.path()), before);
        assert_eq!(
            fs::read_to_string(dir.path().join("notes/bad.md"))
                .await
                .unwrap(),
            bad
        );
    }
}

#[tokio::test]
async fn red_untyped_utf8_import_ipc_preserves_context_and_cause() {
    let (dir, storage) = fixture().await;
    let path = dir.path().join("daily/2026-10-24.md");
    fs::write(&path, [0xff]).await.unwrap();
    let before = index_rows(dir.path());
    let message = ipc_error(
        storage
            .get_or_create_daily_note(Some("2026-10-24"))
            .await
            .unwrap_err(),
    );
    assert!(
        message.contains("indexing daily/2026-10-24.md"),
        "{message}"
    );
    assert!(message.contains("UTF-8"), "{message}");
    assert_eq!(index_rows(dir.path()), before);
    assert_eq!(fs::read(path).await.unwrap(), [0xff]);
}

#[tokio::test]
async fn red_metadata_refusal_logs_only_safe_path_category_and_position() {
    let (dir, storage) = fixture().await;
    let yaml =
        "---\ncoxinha-note: 1\nPRIVATE_KEY: first\nPRIVATE_KEY: PRIVATE_VALUE\n---\n# PRIVATE_BODY";
    fs::write(dir.path().join("notes/private.md"), yaml)
        .await
        .unwrap();
    let error = storage.rebuild_from_vault().await.unwrap_err();
    // The internal cause really contains private parser data; neither sink should expose it.
    assert!(format!("{error:#}").contains("PRIVATE_KEY"));
    let events = Arc::new(std::sync::Mutex::new(String::new()));
    let message = tracing::subscriber::with_default(Capture(events.clone()), || ipc_error(error));
    let logged = events.lock().unwrap().clone();
    assert!(logged.contains("notes/private.md"), "{logged}");
    assert!(logged.contains("metadata"), "{logged}");
    for private in ["PRIVATE_KEY", "PRIVATE_VALUE", "PRIVATE_BODY"] {
        assert!(!message.contains(private), "IPC: {message}");
        assert!(!logged.contains(private), "log: {logged}");
    }
    assert_eq!(
        fs::read_to_string(dir.path().join("notes/private.md"))
            .await
            .unwrap(),
        yaml
    );
}

struct Capture(Arc<std::sync::Mutex<String>>);
impl tracing::Subscriber for Capture {
    fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
        true
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
    fn event(&self, event: &tracing::Event<'_>) {
        struct Fields<'a>(&'a mut String);
        impl tracing::field::Visit for Fields<'_> {
            fn record_debug(&mut self, _: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                use std::fmt::Write;
                write!(self.0, "{value:?} ").unwrap();
            }
        }
        event.record(&mut Fields(&mut self.0.lock().unwrap()));
    }
}
