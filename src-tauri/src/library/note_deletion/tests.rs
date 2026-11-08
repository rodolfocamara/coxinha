use super::*;
use crate::db::Db;
use coxinha_core::store::session::{note_intent::PersonalNoteIntent, NewSession, PersonalNoteRef};
use std::path::Path;

const PROTECTED: &str = "session_note_delete_requires_detach";

async fn fixture() -> (tempfile::TempDir, Arc<Storage>, Library) {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["notes", "daily"] {
        std::fs::create_dir(dir.path().join(sub)).unwrap();
    }
    let storage = Arc::new(Storage::new(
        dir.path().into(),
        Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
    ));
    let library = Library::open(dir.path().join("library"), None).unwrap();
    (dir, storage, library)
}

fn rows(path: &Path, tables: &[&str]) -> Vec<String> {
    let db = rusqlite::Connection::open(path).unwrap();
    let mut values = Vec::new();
    for table in tables {
        let mut query = db
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let columns = query.column_count();
        let records = query
            .query_map([], |row| {
                (0..columns)
                    .map(|i| row.get_ref(i).map(|v| format!("{v:?}")))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        values.extend(records.map(|row| format!("{table}: {:?}", row.unwrap())));
    }
    values
}

#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    file: Option<Vec<u8>>,
    index: Vec<String>,
    canonical: Vec<String>,
}
fn snapshot(root: &Path, path: &str) -> Snapshot {
    Snapshot {
        file: std::fs::read(root.join(path)).ok(),
        index: rows(&root.join("index.db"), &["notes", "notes_fts", "links"]),
        canonical: rows(
            &root.join("library/meetings.db"),
            &["session", "personal_note_intent"],
        ),
    }
}

async fn reserve(library: &Library) -> PersonalNoteIntent {
    let session = library
        .ask(Action::Session(sessions::SessionAction::Create(
            NewSession::manual("Protected"),
        )))
        .await
        .unwrap();
    serde_json::from_value(
        library
            .ask(Action::Session(sessions::SessionAction::Reserve(
                session["id"].as_str().unwrap().into(),
            )))
            .await
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn ipc_service_refuses_complete_and_reserved_notes_without_changing_any_state() {
    for state in ["reserved-unpublished", "reserved-published", "complete"] {
        let (dir, storage, library) = fixture().await;
        let intent = reserve(&library).await;
        if state == "reserved-published" {
            let permit = storage.mutation_permit().await.unwrap();
            storage
                .publish_session_note(&intent, &permit)
                .await
                .unwrap();
        } else if state == "complete" {
            library
                .ensure_note(storage.clone(), intent.session_id.clone())
                .await
                .unwrap();
        }
        let before = snapshot(dir.path(), &intent.relative_path);
        assert_eq!(
            library
                .delete_note(storage.clone(), intent.note_id)
                .await
                .unwrap_err(),
            PROTECTED
        );
        assert_eq!(snapshot(dir.path(), &intent.relative_path), before);
        library.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn legacy_binding_without_intent_is_protected_and_unbound_delete_still_works() {
    let (dir, storage, library) = fixture().await;
    let bound = storage
        .create_note("Legacy", "# Legacy\n[[Target]]")
        .await
        .unwrap();
    library.shutdown().await.unwrap();
    let store = Store::open(dir.path().join("library")).unwrap();
    let session = store
        .create_session(&NewSession::manual("Legacy bound"))
        .unwrap();
    store
        .bind_session_note(
            &session.id,
            &PersonalNoteRef {
                id: bound.id,
                relative_path: bound.path.clone(),
            },
        )
        .unwrap();
    assert!(store.personal_note_intent(&session.id).unwrap().is_none());
    drop(store);
    let library = Library::open(dir.path().join("library"), None).unwrap();
    let before = snapshot(dir.path(), &bound.path);
    assert_eq!(
        library
            .delete_note(storage.clone(), bound.id)
            .await
            .unwrap_err(),
        PROTECTED
    );
    assert_eq!(snapshot(dir.path(), &bound.path), before);
    let ordinary = storage
        .create_note("Unbound", "# Unbound deletion\n[[Target]]")
        .await
        .unwrap();
    let canonical = rows(
        &dir.path().join("library/meetings.db"),
        &["session", "personal_note_intent"],
    );
    library
        .delete_note(storage.clone(), ordinary.id)
        .await
        .unwrap();
    assert!(!dir.path().join(ordinary.path).exists());
    assert!(storage.search_notes("Unbound").await.unwrap().is_empty());
    assert_eq!(storage.list_notes().await.unwrap(), vec![bound]);
    assert_eq!(
        rows(
            &dir.path().join("library/meetings.db"),
            &["session", "personal_note_intent"]
        ),
        canonical
    );
    library.shutdown().await.unwrap();
}

#[tokio::test]
async fn edited_envelope_and_reindexed_uuid_do_not_bypass_canonical_path_protection() {
    for kind in ["reserved", "complete", "legacy"] {
        let (dir, storage, mut library) = fixture().await;
        let reference = if kind == "legacy" {
            let note = storage.create_note("Legacy", "# Legacy").await.unwrap();
            library.shutdown().await.unwrap();
            let store = Store::open(dir.path().join("library")).unwrap();
            let session = store.create_session(&NewSession::manual("Legacy")).unwrap();
            let reference = PersonalNoteRef {
                id: note.id,
                relative_path: note.path,
            };
            store.bind_session_note(&session.id, &reference).unwrap();
            drop(store);
            library = Library::open(dir.path().join("library"), None).unwrap();
            reference
        } else {
            let intent = reserve(&library).await;
            if kind == "reserved" {
                let permit = storage.mutation_permit().await.unwrap();
                storage
                    .publish_session_note(&intent, &permit)
                    .await
                    .unwrap()
            } else {
                let result = library
                    .ensure_note(storage.clone(), intent.session_id)
                    .await
                    .unwrap();
                serde_json::from_value(result["personal_note"].clone()).unwrap()
            }
        };
        // Remove every editable ownership field, replace the UUID, then rebuild.
        let replacement = Uuid::new_v4();
        std::fs::write(
            dir.path().join(&reference.relative_path),
            format!("---\ncoxinha-note: 1\nid: {replacement}\n---\n# Edited ownership\n"),
        )
        .unwrap();
        storage.rebuild_from_vault().await.unwrap();
        let before = snapshot(dir.path(), &reference.relative_path);
        assert_eq!(
            library
                .delete_note(storage.clone(), replacement)
                .await
                .unwrap_err(),
            PROTECTED
        );
        assert_eq!(snapshot(dir.path(), &reference.relative_path), before);
        library.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn unavailable_library_refuses_even_unbound_deletion_without_mutation() {
    let (dir, storage, library) = fixture().await;
    let note = storage
        .create_note("Keep", "# Unbound but library unavailable")
        .await
        .unwrap();
    library.shutdown().await.unwrap();
    let before = snapshot(dir.path(), &note.path);
    let error = library.delete_note(storage, note.id).await.unwrap_err();
    assert!(error.contains("cannot verify canonical session note references"));
    assert_eq!(snapshot(dir.path(), &note.path), before);
}

#[tokio::test]
async fn deletion_waits_for_whole_ensure_then_refuses_its_committed_reservation() {
    let (dir, storage, library) = fixture().await;
    let intent = reserve(&library).await;
    let writer = storage.hold_note_writer().await;
    let lib = library.clone();
    let st = storage.clone();
    let session = intent.session_id.clone();
    let ensure = tokio::spawn(async move { lib.ensure_note(st, session).await });
    // Observe the actual shared mutation permit, not elapsed startup time.
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if storage.operation_in_progress() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let delete = library.delete_note(storage.clone(), intent.note_id);
    tokio::pin!(delete);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut delete)
            .await
            .is_err()
    );
    assert!(!dir.path().join(&intent.relative_path).exists());
    drop(writer);
    ensure.await.unwrap().unwrap();
    assert_eq!(delete.await.unwrap_err(), PROTECTED);
    assert!(dir.path().join(&intent.relative_path).exists());
    library.shutdown().await.unwrap();
}

#[tokio::test]
async fn cancelled_delete_keeps_exit_barrier_until_canonical_check_and_mutation_finish() {
    let (dir, storage, real) = fixture().await;
    let note = storage
        .create_note("Owned task", "# Delete after check")
        .await
        .unwrap();
    real.shutdown().await.unwrap();
    let (sender, receiver) = std::sync::mpsc::sync_channel::<Request>(16);
    let mock = Library {
        sender,
        root: Default::default(),
        live: Default::default(),
    };
    let (observed, observation) = tokio::sync::oneshot::channel();
    let (resume, resumed) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let query = receiver.recv().unwrap();
        assert!(matches!(
            query.action,
            Action::Session(sessions::SessionAction::ProtectsNote(_, _))
        ));
        observed.send(()).unwrap();
        resumed.recv().unwrap();
        query.reply.send(Ok(json!(false))).unwrap();
    });
    let st = storage.clone();
    let delete = tokio::spawn(async move { mock.delete_note(st, note.id).await });
    observation.await.unwrap();
    delete.abort();
    // A new ensure cannot obtain its shared permit and dispatch a reservation
    // between the canonical protection query and filesystem deletion.
    let mut mutation = Box::pin(storage.mutation_permit());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), mutation.as_mut())
            .await
            .is_err()
    );
    drop(mutation);
    let mut exit = Box::pin(storage.quiesce());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), exit.as_mut())
            .await
            .is_err()
    );
    assert!(dir.path().join(&note.path).exists());
    resume.send(()).unwrap();
    let _exit = tokio::time::timeout(std::time::Duration::from_secs(2), exit)
        .await
        .unwrap();
    assert!(!dir.path().join(&note.path).exists());
    assert!(storage.list_notes().await.unwrap().is_empty());
    worker.join().unwrap();
}

#[tokio::test]
async fn committed_exit_refuses_later_delete_without_file_or_index_mutation() {
    let (dir, storage, library) = fixture().await;
    let note = storage
        .create_note("Keep after exit", "# Keep")
        .await
        .unwrap();
    let before = snapshot(dir.path(), &note.path);
    let exit = storage.quiesce().await;
    storage.commit_shutdown(&exit);
    drop(exit);
    assert_eq!(
        library.delete_note(storage, note.id).await.unwrap_err(),
        "desktop shutdown committed; mutation rejected"
    );
    assert_eq!(snapshot(dir.path(), &note.path), before);
    library.shutdown().await.unwrap();
}

#[path = "timeout_tests.rs"]
mod timeout_tests;
