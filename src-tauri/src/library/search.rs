//! Universal search (spec 0122) over the running app's data.
use super::*;
use crate::cli::{paths::Paths, universal};
use crate::storage::Storage;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// The newest query; an older scan still running stops at its next session.
static LATEST: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
#[specta::specta]
pub async fn universal_search(
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
    let limit = limit.unwrap_or(20).clamp(1, 20) as usize;
    let generation = LATEST.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let stale = || LATEST.load(Ordering::SeqCst) != generation;
        universal::universal(&paths, &query, limit, &stale).map(|answer| json!(answer))
    })
    .await
    .map_err(|e| e.to_string())?
}
