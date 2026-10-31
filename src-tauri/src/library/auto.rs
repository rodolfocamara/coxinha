//! Library operations for automatic recording (spec 0097). The same actions
//! and storage permit as the IPC commands; no capture path of its own.
use super::sessions::SessionAction;
use super::*;
use crate::storage::Storage;
use coxinha_core::store::session::NewSession;
use std::sync::Arc;

async fn mutate(
    library: &Library,
    storage: &Arc<Storage>,
    action: Action,
) -> Result<Value, String> {
    let _permit = storage.mutation_permit().await.map_err(|e| e.to_string())?;
    library.ask(action).await
}

impl Library {
    pub(crate) async fn status_value(&self) -> Result<Value, String> {
        self.ask(Action::Status).await
    }
    pub(crate) async fn stop_capture(&self) -> Result<Value, String> {
        self.ask(Action::Stop).await
    }
    pub(crate) async fn session_list(&self) -> Result<Value, String> {
        self.ask(Action::Session(SessionAction::List)).await
    }
    pub(crate) async fn create_session(
        &self,
        storage: &Arc<Storage>,
        input: NewSession,
    ) -> Result<Value, String> {
        mutate(self, storage, Action::Session(SessionAction::Create(input))).await
    }
    /// Same as `library_start_session`: the title comes from the session.
    pub(crate) async fn start_session(
        &self,
        storage: &Arc<Storage>,
        session: &str,
        title: String,
        mic: String,
        output: String,
    ) -> Result<Value, String> {
        mutate(
            self,
            storage,
            Action::Start {
                session: Some(session.to_owned()),
                title,
                mic,
                output,
            },
        )
        .await
    }
    pub(crate) async fn set_participants(
        &self,
        meeting: &str,
        people: Value,
    ) -> Result<Value, String> {
        self.ask(Action::SetParticipantContext(meeting.to_owned(), people))
            .await
    }
}
