//! First-use download of the fallback transcription model (spec 0099). Runs
//! only on an explicit click; the file is renamed into place after its
//! checksum matches, so a present file is always a verified one.
use crate::library::{Library, LiveSettings};
use crate::speech_models::{FALLBACK_BYTES, FALLBACK_FILE, FALLBACK_SHA256, FALLBACK_URL};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};

pub const PROGRESS_EVENT: &str = "speech-model-progress";

#[tauri::command]
#[specta::specta]
pub async fn speech_model_download(
    app: AppHandle,
    state: State<'_, Library>,
) -> Result<LiveSettings, String> {
    let dir = crate::settings_file::app_file(&app, "models")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(FALLBACK_FILE);
    if !target.is_file() {
        let partial = dir.join(format!("{FALLBACK_FILE}.part"));
        if let Err(error) = fetch(&app, &partial).await {
            let _ = std::fs::remove_file(&partial);
            return Err(error);
        }
        std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    }
    let mut settings = crate::library::load_live_settings(&app);
    settings.model_path = target.display().to_string();
    settings.enabled = true;
    crate::library::set_live_settings(app, state, settings).await
}

async fn fetch(app: &AppHandle, partial: &Path) -> Result<(), String> {
    let failed = |e: reqwest::Error| format!("Model download failed: {e}");
    let mut response = reqwest::get(FALLBACK_URL)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(failed)?;
    let mut file = std::fs::File::create(partial).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let (mut done, mut shown) = (0u64, u64::MAX);
    while let Some(chunk) = response.chunk().await.map_err(failed)? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hash.update(&chunk);
        done += chunk.len() as u64;
        let percent = (done * 100 / FALLBACK_BYTES).min(100);
        if percent != shown {
            shown = percent;
            let _ = app.emit(PROGRESS_EVENT, percent);
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    let digest = format!("{:x}", hash.finalize());
    if digest != FALLBACK_SHA256 {
        return Err("Downloaded model failed the checksum; nothing was saved".into());
    }
    Ok(())
}

/// The bundled speaker models over the live transcript, for manual processing.
#[tauri::command]
#[specta::specta]
pub async fn speech_default_processing_config() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = crate::speech_models::speaker_dir()
            .ok_or("Speaker models are not bundled with this build")?;
        crate::speech_models::processing_config(&dir).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
