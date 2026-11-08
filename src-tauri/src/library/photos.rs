//! Directory photos on the library worker (spec 0117 P1): the database and the
//! private folder stay with the one thread that owns them.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use coxinha_core::identity::photos::{DuePhoto, PhotoInvitee};

pub(crate) enum PhotoAction {
    Status,
    Enable,
    Disable,
    Block(String),
    Pause(i64),
    Sweep,
    Due {
        invitees: Vec<PhotoInvitee>,
        now: i64,
        limit: usize,
    },
    Record {
        person: String,
        now: i64,
        photo: Option<Vec<u8>>,
    },
    Index,
    Read(String),
}

impl Worker {
    pub(super) fn photo_action(&mut self, action: PhotoAction) -> anyhow::Result<Value> {
        let store = &self.store;
        Ok(match action {
            PhotoAction::Status => json!(store.photo_status()?),
            PhotoAction::Enable => json!(store.photo_enable()?),
            PhotoAction::Disable => json!(store.photo_disable()?),
            PhotoAction::Block(code) => json!(store.photo_block(&code)?),
            PhotoAction::Pause(until) => json!(store.photo_pause(until)?),
            PhotoAction::Sweep => json!(store.photo_sweep()?),
            PhotoAction::Due {
                invitees,
                now,
                limit,
            } => json!(store.photo_due(&invitees, now, limit)?),
            PhotoAction::Record { person, now, photo } => {
                json!(store.photo_record(&person, now, photo.as_deref())?)
            }
            PhotoAction::Index => json!(store.photo_index()?),
            // Base64 through IPC: the webview gets the image, never a file path.
            PhotoAction::Read(person) => json!(store
                .photo_read(&person)?
                .map(|(media, bytes)| format!("data:{media};base64,{}", STANDARD.encode(bytes)))),
        })
    }
}

impl Library {
    pub(crate) async fn photos(&self, action: PhotoAction) -> Result<Value, String> {
        self.ask(Action::Photo(action)).await
    }
    pub(crate) async fn photos_due(
        &self,
        invitees: Vec<PhotoInvitee>,
        now: i64,
        limit: usize,
    ) -> Result<Vec<DuePhoto>, String> {
        let due = self
            .photos(PhotoAction::Due {
                invitees,
                now,
                limit,
            })
            .await?;
        serde_json::from_value(due).map_err(|e| e.to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn directory_photos_status(state: State<'_, Library>) -> Result<Value, String> {
    state.photos(PhotoAction::Status).await
}
/// Who has a photo. Invitee lists match by name, like the speaker names (spec 0102).
#[tauri::command]
#[specta::specta]
pub async fn person_photo_index(state: State<'_, Library>) -> Result<Value, String> {
    state.photos(PhotoAction::Index).await
}
#[tauri::command]
#[specta::specta]
pub async fn person_photo(state: State<'_, Library>, person_id: String) -> Result<Value, String> {
    state.photos(PhotoAction::Read(person_id)).await
}
