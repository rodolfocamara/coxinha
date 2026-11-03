//! Reuniões search (spec 0107): the CLI search over the running app's data.
use super::*;
use crate::cli::{paths::Paths, search};
use crate::storage::Storage;
use std::sync::Arc;

#[tauri::command]
#[specta::specta]
pub async fn library_search(
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
    query: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let data = state
        .root
        .parent()
        .ok_or("library has no data folder")?
        .to_path_buf();
    let paths = Paths {
        vault: storage.vault().to_path_buf(),
        data,
    };
    let limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    tauri::async_runtime::spawn_blocking(move || {
        search::search(&paths, &query, limit).map(|hits| json!(hits))
    })
    .await
    .map_err(|e| e.to_string())?
}
