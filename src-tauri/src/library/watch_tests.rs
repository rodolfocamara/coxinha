use super::*;
use coxinha_core::{
    capture::{Recording, Track},
    store::session::NewSession,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn worker(store: Store) -> Worker {
    Worker {
        curation: Default::default(),
        processing: None,
        store,
        #[cfg(target_os = "linux")]
        active: None,
        error: None,
        finalization_failed: None,
        live: Default::default(),
        root: Default::default(),
    }
}
fn counter() -> (Arc<AtomicUsize>, Notifier) {
    let count = Arc::new(AtomicUsize::new(0));
    let fired = count.clone();
    (
        count,
        Box::new(move || {
            fired.fetch_add(1, Ordering::SeqCst);
        }),
    )
}

#[test]
fn live_is_set_only_for_the_active_meeting() {
    assert_eq!(
        live_value(Some(("m1", false)), Some("m1")),
        json!({"paused": false})
    );
    assert_eq!(
        live_value(Some(("m1", true)), Some("m1")),
        json!({"paused": true})
    );
    assert!(live_value(Some(("m1", false)), Some("m2")).is_null());
    assert!(live_value(Some(("m1", false)), None).is_null());
    assert!(live_value(None, Some("m1")).is_null());
}

#[test]
fn sessions_expose_null_live_without_capture() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let session = store
        .create_session(&NewSession::manual("Idle session"))
        .unwrap();
    let worker = worker(store);
    let list = worker.session_action(SessionAction::List).unwrap();
    let detail = worker
        .session_action(SessionAction::Detail(session.id))
        .unwrap();
    for value in [&list[0], &detail] {
        assert!(value.as_object().unwrap().contains_key("live"));
        assert!(value["live"].is_null());
    }
}

#[test]
fn watch_notifies_on_capture_state_changes_only() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let id = store.create_meeting("failed finalization").unwrap();
    let mut recording = Recording::start(&store, &id, "fixture-input", "fixture-monitor").unwrap();
    recording.write_block(Track::Mic, &[3; 960], 1).unwrap();
    drop(recording);
    let mut worker = worker(store);
    worker.finalization_failed = Some(id.clone());
    let (count, notify) = counter();
    let mut watch = CaptureWatch::new(&worker, Some(notify));
    worker.execute(Action::Status).unwrap();
    worker.pump();
    watch.observe(&worker);
    assert_eq!(count.load(Ordering::SeqCst), 0);
    worker.execute(Action::Recover(id)).unwrap();
    watch.observe(&worker);
    watch.observe(&worker);
    assert_eq!(count.load(Ordering::SeqCst), 1);
    worker.error = Some("capture interrupted; inspect recording details".into());
    watch.observe(&worker);
    worker.execute(Action::Status).unwrap();
    watch.observe(&worker);
    assert_eq!(count.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn status_polling_does_not_notify() {
    let temp = tempfile::tempdir().unwrap();
    let (count, notify) = counter();
    let library = Library::open(temp.path().into(), Some(notify)).unwrap();
    for _ in 0..3 {
        library.ask(Action::Status).await.unwrap();
    }
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    assert_eq!(count.load(Ordering::SeqCst), 0);
    library.shutdown().await.unwrap();
}
