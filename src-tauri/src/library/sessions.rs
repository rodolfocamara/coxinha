//! Session IPC orchestration. The worker never locks/waits for Storage.
use super::*;
use crate::storage::Storage;
use coxinha_core::store::session::{note_intent::PersonalNoteIntent, NewSession, PersonalNoteRef};
use std::sync::Arc;

pub(super) enum SessionAction {
    List,
    Detail(String),
    Create(NewSession),
    Update(String, NewSession),
    Reserve(String),
    Complete(String, PersonalNoteRef),
    Failed(String, String),
    Pending,
    ProtectsNote(uuid::Uuid, Option<String>),
}
impl Worker {
    fn session_value(&self, id: &str) -> anyhow::Result<Value> {
        let session = self
            .store
            .session(id)?
            .ok_or_else(|| anyhow::anyhow!("session not found"))?;
        let mut value = json!(session);
        value["note_error"] = json!(self
            .store
            .personal_note_intent(id)?
            .and_then(|i| i.last_error));
        value["transcript_status"] = json!(match session.meeting_id.as_deref() {
            Some(meeting) => self.store.meeting_transcript_status(meeting)?,
            None => coxinha_core::store::transcript_summary::TranscriptStatus::None,
        });
        value["processing_state"] = match &session.meeting_id {
            Some(id) => self
                .store
                .meeting_processing_jobs(id)?
                .first()
                .map(|j| j["state"].clone())
                .unwrap_or(Value::Null),
            None => Value::Null,
        };
        value["recording"] = json!(self
            .store
            .meeting_summaries()?
            .into_iter()
            .find(|m| Some(m["id"].as_str().unwrap_or("")) == session.meeting_id.as_deref()));
        value["live"] = self.live(session.meeting_id.as_deref());
        Ok(value)
    }
    pub(super) fn session_action(&self, action: SessionAction) -> anyhow::Result<Value> {
        match action {
            SessionAction::List => {
                let recordings = self.store.meeting_summaries()?;
                let recordings: std::collections::HashMap<_, _> = recordings
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(|id| (id, m)))
                    .collect();
                let processing = self.status()["processing"].clone();
                let transcripts = self.store.meeting_transcript_statuses()?;
                let mut values = Vec::new();
                for session in self.store.list_sessions()? {
                    let mut value = json!(session);
                    value["note_error"] = json!(self
                        .store
                        .personal_note_intent(&session.id)?
                        .and_then(|i| i.last_error));
                    value["recording"] = json!(session
                        .meeting_id
                        .as_deref()
                        .and_then(|id| recordings.get(id)));
                    value["transcript_status"] = json!(session
                        .meeting_id
                        .as_deref()
                        .and_then(|id| transcripts.get(id))
                        .copied()
                        .unwrap_or_default());
                    value["processing_state"] = match &session.meeting_id {
                        Some(id) => self
                            .store
                            .meeting_processing_jobs(id)?
                            .first()
                            .map(|j| j["state"].clone())
                            .unwrap_or(Value::Null),
                        None => Value::Null,
                    };
                    value["processing"] = if session
                        .meeting_id
                        .as_deref()
                        .is_some_and(|id| processing["meetingId"].as_str() == Some(id))
                    {
                        processing.clone()
                    } else {
                        Value::Null
                    };
                    value["live"] = self.live(session.meeting_id.as_deref());
                    values.push(value);
                }
                Ok(json!(values))
            }
            SessionAction::Detail(id) => self.session_value(&id),
            SessionAction::Create(input) => {
                let s = self.store.create_session(&input)?;
                self.session_value(&s.id)
            }
            SessionAction::Update(id, input) => {
                self.store.update_session(&id, &input)?;
                self.session_value(&id)
            }
            SessionAction::Reserve(id) => Ok(json!(self.store.reserve_personal_note(&id)?)),
            SessionAction::Complete(id, note) => {
                self.store.complete_personal_note(&id, &note)?;
                self.session_value(&id)
            }
            SessionAction::Failed(id, error) => {
                self.store.personal_note_error(&id, &error)?;
                Ok(Value::Null)
            }
            SessionAction::ProtectsNote(id, path) => Ok(json!(self
                .store
                .personal_note_is_protected(id, path.as_deref())?)),
            SessionAction::Pending => Ok(json!(self.store.pending_personal_notes()?)),
        }
    }
}
impl Library {
    pub(super) async fn ensure_note(
        &self,
        storage: Arc<Storage>,
        id: String,
    ) -> Result<Value, String> {
        // Spawn owns the entire operation, so dropping an IPC receiver cannot drop
        // the exit permit while an already authorized publication is still running.
        let library = self.clone();
        tauri::async_runtime::spawn(async move {
            let permit = storage.mutation_permit().await.map_err(|e| e.to_string())?;
            let intent: PersonalNoteIntent = serde_json::from_value(
                library
                    .ask(Action::Session(SessionAction::Reserve(id.clone())))
                    .await?,
            )
            .map_err(|e| e.to_string())?;
            let note = match storage.publish_session_note(&intent, &permit).await {
                Ok(note) => note,
                Err(error) => {
                    if let Some(code) = error.persistent_code() {
                        let _ = library
                            .ask(Action::Session(SessionAction::Failed(id, code.into())))
                            .await;
                    }
                    return Err(error.into_ipc());
                }
            };
            // Worker busy/shutdown/IO failures have no proven publication conflict.
            // Do not persist them as note ownership errors.
            library
                .ask(Action::Session(SessionAction::Complete(id, note)))
                .await
        })
        .await
        .map_err(|e| e.to_string())?
    }
    pub fn reconcile_session_notes(&self, storage: Arc<Storage>) {
        let library = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(value) = library.ask(Action::Session(SessionAction::Pending)).await {
                if let Ok(pending) = serde_json::from_value::<Vec<String>>(value) {
                    for id in pending {
                        // Errors are retained per session, never fail the whole vault.
                        let _ = library.ensure_note(storage.clone(), id).await;
                    }
                }
            }
        });
    }
}

#[tauri::command]
#[specta::specta]
pub async fn library_sessions(state: State<'_, Library>) -> Result<Value, String> {
    state.ask(Action::Session(SessionAction::List)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_session(
    state: State<'_, Library>,
    session_id: String,
) -> Result<Value, String> {
    state
        .ask(Action::Session(SessionAction::Detail(session_id)))
        .await
}
async fn mutate(library: Library, storage: Arc<Storage>, action: Action) -> Result<Value, String> {
    tauri::async_runtime::spawn(async move {
        let _permit = storage.mutation_permit().await.map_err(|e| e.to_string())?;
        library.ask(action).await
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub async fn library_create_session(
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
    input: Value,
) -> Result<Value, String> {
    let input = serde_json::from_value(input).map_err(|e| e.to_string())?;
    mutate(
        state.inner().clone(),
        storage.inner().clone(),
        Action::Session(SessionAction::Create(input)),
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_update_session(
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
    session_id: String,
    input: Value,
) -> Result<Value, String> {
    let input = serde_json::from_value(input).map_err(|e| e.to_string())?;
    mutate(
        state.inner().clone(),
        storage.inner().clone(),
        Action::Session(SessionAction::Update(session_id, input)),
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_ensure_personal_note(
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
    session_id: String,
) -> Result<Value, String> {
    state.ensure_note(storage.inner().clone(), session_id).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_start_session(
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
    session_id: String,
    mic_source: String,
    output_source: String,
) -> Result<Value, String> {
    let session = state
        .ask(Action::Session(SessionAction::Detail(session_id.clone())))
        .await?;
    let title = session["recording"]["title"]
        .as_str()
        .or_else(|| session["title"].as_str())
        .ok_or("session title missing")?
        .to_owned();
    mutate(
        state.inner().clone(),
        storage.inner().clone(),
        Action::Start {
            session: Some(session_id),
            title,
            mic: mic_source,
            output: output_source,
        },
    )
    .await
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod review_tests;

#[cfg(test)]
mod transcript_tests;
