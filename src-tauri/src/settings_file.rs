//! Small JSON settings files in the app data directory, replaced atomically.
use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub fn app_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let profile = crate::app_paths::TestProfile::from_env().map_err(|e| e.to_string())?;
    Ok(match profile {
        Some(profile) => profile.root.join("app-data").join(name),
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(name),
    })
}
pub fn load<T: DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}
pub fn save<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("settings path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, value).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
