//! Spec 0119 P1: the agenda's repairs of spec 0115 (joining a recording into
//! its prepared session, dating unscheduled recordings) run after every
//! calendar refresh and once at startup, not only while the agenda is open.
use super::calendar_match::{recordings, Recording};
use super::*;
use crate::calendar::Event;
use crate::storage::Storage;
use sessions::SessionAction;
use std::sync::Arc;

/// IPC and the background refresh may overlap; one pass at a time.
static PASS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Joins duplicates, dates recordings closed without a time, and returns the
/// closed recordings for the calendar match proposals.
pub(super) async fn reconcile(
    library: &Library,
    storage: &Arc<Storage>,
    events: &[Event],
) -> Result<Vec<Recording>, String> {
    let _pass = PASS.lock().await;
    super::absorb::sweep(library, storage, events).await;
    let sessions = library.session_list().await?;
    let root = library.root.clone();
    let (recordings, sessions) =
        tauri::async_runtime::spawn_blocking(move || (recordings(&root, &sessions), sessions))
            .await
            .map_err(|e| e.to_string())?;
    for r in &recordings {
        let unscheduled = sessions.as_array().is_some_and(|list| {
            list.iter().any(|s| {
                s["id"].as_str() == Some(r.session.as_str())
                    && s["starts_at"].is_null()
                    && s["ends_at"].is_null()
            })
        });
        if unscheduled {
            let end = r.end.format("%Y-%m-%dT%H:%M:%SZ").to_string();
            let action = SessionAction::DateUnscheduled(r.meeting.clone(), end);
            if let Err(error) = library.ask(Action::Session(action)).await {
                tracing::warn!("recording kept no agenda time: {error}");
            }
        }
    }
    Ok(recordings)
}

/// Background entry point: the cached agenda, with the app's own state.
pub async fn reconcile_agenda(app: &tauri::AppHandle, events: &[Event]) {
    let (Some(library), Some(storage)) =
        (app.try_state::<Library>(), app.try_state::<Arc<Storage>>())
    else {
        return;
    };
    // The agenda polls the session list, so no event is needed.
    if let Err(error) = reconcile(&library, &storage, events).await {
        tracing::warn!("agenda not reconciled: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use coxinha_core::store::session::{NewSession, SessionStatus};

    fn event() -> Event {
        serde_json::from_value(json!({
            "id": "evt-roadmap", "title": "Roadmap with Ana",
            "startsAt": "2026-11-03T12:00:00Z", "endsAt": "2026-11-03T13:00:00Z",
            "cancelled": false, "allDay": false,
            "attendees": [{ "name": "Ana", "email": "ana@example.com" }],
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn a_refresh_pass_joins_the_prepared_and_recorded_sessions_once() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir(d.path().join("notes")).unwrap();
        let storage = Arc::new(Storage::new(
            d.path().into(),
            Arc::new(Db::open(&d.path().join("index.db")).unwrap()),
        ));
        let root = d.path().join("library");
        let store = Store::open(&root).unwrap();
        let input = || NewSession {
            title: "Roadmap with Ana".into(),
            starts_at: Some("2026-11-03T12:00:00Z".into()),
            ends_at: Some("2026-11-03T13:00:00Z".into()),
            status: SessionStatus::Planned,
        };
        let prepared = store.create_session(&input()).unwrap();
        let recorded = store.create_session(&input()).unwrap();
        let meeting = store
            .create_meeting_for_session(&recorded.id, "Meeting in Google Chrome")
            .unwrap();
        drop(store);
        let library = Library::open(root, None).unwrap();

        reconcile(&library, &storage, &[event()]).await.unwrap();
        let after = library.session_list().await.unwrap();
        let ids: Vec<_> = after
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["id"].clone())
            .collect();
        assert_eq!(ids, [json!(prepared.id)]);
        assert_eq!(after[0]["meeting_id"], json!(meeting));

        // A second refresh changes nothing.
        reconcile(&library, &storage, &[event()]).await.unwrap();
        assert_eq!(library.session_list().await.unwrap(), after);
        library.shutdown().await.unwrap();
    }
}
