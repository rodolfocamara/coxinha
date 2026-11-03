//! Files and links of meetings and activities (spec 0105).
pub mod files;
pub mod folder;
pub mod links;

#[cfg(test)]
mod files_tests;
#[cfg(test)]
mod folder_tests;
#[cfg(test)]
mod links_tests;

use crate::storage::Storage;
use files::{ItemFiles, OpenTarget, Resolved};
use folder::ItemRef;
use links::Link;
use std::sync::Arc;
use tauri_plugin_opener::OpenerExt;

type Vault<'a> = tauri::State<'a, Arc<Storage>>;

async fn permit(storage: &Storage) -> Result<tokio::sync::RwLockReadGuard<'_, ()>, String> {
    storage
        .mutation_permit()
        .await
        .map_err(|_| "desktop shutdown committed".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn items_list(storage: Vault<'_>, item: ItemRef) -> Result<ItemFiles, String> {
    files::list(storage.vault(), &item)
}

#[tauri::command]
#[specta::specta]
pub async fn items_include(
    storage: Vault<'_>,
    item: ItemRef,
    paths: Vec<String>,
) -> Result<ItemFiles, String> {
    let _operation = permit(&storage).await?;
    let vault = storage.vault().to_path_buf();
    // Copies can be large; keep them off the async runtime.
    tauri::async_runtime::spawn_blocking(move || files::include(&vault, &item, &paths))
        .await
        .map_err(|_| "copy task failed".to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn items_reference(
    storage: Vault<'_>,
    item: ItemRef,
    target: String,
    label: Option<String>,
) -> Result<ItemFiles, String> {
    let _operation = permit(&storage).await?;
    files::reference(storage.vault(), &item, &target, label)
}

#[tauri::command]
#[specta::specta]
pub async fn items_remove_reference(
    storage: Vault<'_>,
    item: ItemRef,
    target: String,
) -> Result<ItemFiles, String> {
    let _operation = permit(&storage).await?;
    files::remove_reference(storage.vault(), &item, &target)
}

#[tauri::command]
#[specta::specta]
pub async fn items_remove_file(
    storage: Vault<'_>,
    item: ItemRef,
    name: String,
) -> Result<ItemFiles, String> {
    let _operation = permit(&storage).await?;
    files::remove_file(storage.vault(), &item, &name)
}

#[tauri::command]
#[specta::specta]
pub async fn items_open(
    app: tauri::AppHandle,
    storage: Vault<'_>,
    item: ItemRef,
    target: OpenTarget,
) -> Result<(), String> {
    let opener = app.opener();
    match files::resolve(storage.vault(), &item, &target)? {
        Resolved::Path(path) => opener.open_path(path.to_string_lossy(), None::<&str>),
        Resolved::Url(url) => opener.open_url(url, None::<&str>),
    }
    .map_err(|_| "cannot open the file".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn items_reveal(
    app: tauri::AppHandle,
    storage: Vault<'_>,
    item: ItemRef,
) -> Result<(), String> {
    let dir = folder::find(storage.vault(), &item)?.ok_or("item has no files")?;
    app.opener()
        .reveal_item_in_dir(dir)
        .map_err(|_| "cannot show the folder".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn links_list(
    storage: Vault<'_>,
    session: Option<String>,
    note: Option<String>,
) -> Result<Vec<Link>, String> {
    links::list(storage.vault(), session.as_deref(), note.as_deref())
}

#[tauri::command]
#[specta::specta]
pub async fn links_add(storage: Vault<'_>, session: String, note: String) -> Result<(), String> {
    let _operation = permit(&storage).await?;
    links::add(storage.vault(), &session, &note)
}

#[tauri::command]
#[specta::specta]
pub async fn links_remove(storage: Vault<'_>, session: String, note: String) -> Result<(), String> {
    let _operation = permit(&storage).await?;
    links::remove(storage.vault(), &session, &note)
}
