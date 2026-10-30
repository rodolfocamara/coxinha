use super::*;
pub(super) async fn complete_exit(app: &AppHandle, allow_interrupted: bool) -> Result<(), String> {
    // The exclusive storage guard waits until each in-flight filesystem+index operation ends,
    // and prevents delayed frontend IPC from starting a new mutation before process exit.
    let storage = app.state::<std::sync::Arc<crate::storage::Storage>>();
    let _storage_guard = storage.quiesce().await;
    let state = app.state::<std::sync::Arc<tokio::sync::Mutex<crate::config::AppState>>>();
    let mut state = state.lock().await;
    if state.recorder.is_recording() && state.recorder.stop().await.is_err() {
        if !allow_interrupted {
            return Err("legacy recorder finalization failed".into());
        }
        let _ = app
            .state::<Desktop>()
            .record("legacy_recording_recovery_required");
    }
    let library = app.state::<crate::library::Library>();
    if allow_interrupted {
        // Raw data is retained even if finalization metadata cannot be persisted.
        match library.shutdown_preserving_raw().await {
            Ok(value) => {
                if value["captureRecoveryRequired"] == true
                    || value["processingRecoveryRequired"] == true
                {
                    let _ = app.state::<Desktop>().record("recording_recovery_required");
                }
            }
            Err(_) => {
                let _ = app
                    .state::<Desktop>()
                    .record("library_unavailable_recovery_required");
            }
        }
    } else {
        library.shutdown().await?;
    }
    let _ = app.state::<Desktop>().record(if allow_interrupted {
        "explicit_unsaved_exit"
    } else {
        "exit_complete"
    });
    #[cfg(target_os = "linux")]
    {
        let audio = app
            .state::<std::sync::Arc<crate::native_audio::NativeAudio>>()
            .inner()
            .clone();
        // All fallible exit decisions are complete. No callback to UI/library/storage is needed.
        let _ = tauri::async_runtime::spawn_blocking(move || audio.stop()).await;
    }
    if let Some(detector) = app.try_state::<crate::call_detector::Detector>() {
        detector.stop();
    }
    storage.commit_shutdown(&_storage_guard);
    app.exit(0);
    Ok(())
}
