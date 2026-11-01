//! Coxinha library entry point.
//!
//! - Sets up logging
//! - Registers Tauri plugins
//! - Creates the tray icon
//! - Registers global shortcuts
//! - Exposes typed IPC commands (specta)

// Port from Handy (ADR-0014). Items stay `pub` so spec 0007 wires
// the recorder into them directly — the whole module is dead code
// in the crate today and `#[allow(dead_code)]` here keeps the port
// faithful without sprinkling the allow attribute on every symbol.
mod app_paths;
#[allow(dead_code)]
mod audio_toolkit;
mod auto_record;
mod board;
mod calendar;
mod call_detector;
mod config;
mod db;
mod desktop;
mod diarizer;
mod events;
mod library;
#[cfg(target_os = "linux")]
mod native_audio;
mod note_errors;
mod obsidian;
mod recorder;
mod shortcuts;
mod storage;
mod summarizer;
// Spec 0097 P4: the meeting actor wires this in; nothing calls it yet.
#[allow(dead_code, unused_imports)]
mod titles;
mod transcriber;
mod tray;
mod window;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use tracing::info;

use crate::config::AppState;

// Load YAML locale files from `src-tauri/locales/` at compile time.
// Use `t!("tray.open")` etc. from anywhere in the crate.
rust_i18n::i18n!("locales", fallback = "en");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "coxinha=debug,info".into()),
        )
        .init();

    set_initial_locale();

    info!("Coxinha starting...");

    let test_profile = app_paths::TestProfile::from_env().expect("valid native test profile");
    let mut context = tauri::generate_context!();
    if let Some(profile) = &test_profile {
        for window in &mut context.config_mut().app.windows {
            window.data_directory = Some(profile.webview());
            // WKWebView does not support a custom data directory. Its ephemeral
            // store prevents persistent browser data on macOS as well.
            window.incognito = true;
        }
    }

    let specta_builder = build_specta();

    #[cfg(all(debug_assertions, dev))]
    export_bindings_if_changed(&specta_builder);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcuts::handle_shortcut)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            let logs = match &test_profile {
                Some(profile) => profile.logs(),
                None => app.path().app_log_dir()?,
            };
            let library = match &test_profile {
                Some(profile) => profile.library(),
                None => app.path().app_data_dir()?.join("meeting-library"),
            };
            app.manage(desktop::Desktop::new(logs)?);
            let handle = app.handle().clone();
            let notify: library::Notifier = Box::new(move || {
                let _ = tauri_specta::Event::emit(&events::CaptureChanged::now(), &handle);
            });
            app.manage(library::Library::open(library, Some(notify))?);
            #[cfg(target_os = "linux")]
            app.manage(Arc::new(native_audio::NativeAudio::start(
                native_audio::app_origins(app.config()),
            )?));

            // Tauri's .setup is sync; block_on is the bridge for
            // AppState::initialize's async signature.
            let state =
                tauri::async_runtime::block_on(async { AppState::initialize(app.handle()).await })?;

            shortcuts::register_all(app.handle(), &state.config.shortcuts)?;

            if !state.config.locale.is_empty() {
                rust_i18n::set_locale(&normalize_locale(&state.config.locale));
            }

            // Hot-path commands take `tauri::State<'_, Arc<Storage>>`
            // directly so saves don't serialize against searches via
            // the AppState mutex. Commands spanning multiple
            // subsystems still go through the full state below.
            app.state::<library::Library>()
                .reconcile_session_notes(state.storage.clone());
            app.manage(state.storage.clone());

            let shared_state = Arc::new(Mutex::new(state));
            app.manage(shared_state);

            tray::setup(app.handle())?;
            if !std::env::args().any(|arg| arg == "--hidden") {
                window::show_main(app.handle());
            }

            let auto_record = auto_record::AutoRecord::load(match &test_profile {
                Some(profile) => profile.root.join("app-data/auto-record.json"),
                None => app.path().app_data_dir()?.join("auto-record.json"),
            });
            let detector = call_detector::Detector::default();
            if auto_record.enabled() {
                detector.enable_for_auto_record();
            }
            app.manage(auto_record);
            app.manage(detector);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = call_detector::run_loop(handle).await {
                    tracing::error!("Call detector loop failed: {:?}", e);
                }
            });

            info!("Coxinha ready");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                desktop::request_exit(window.app_handle());
            }
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|_, _| {});
}

/// Escape hatch for integration tests in `tests/perf_*.rs` that
/// need Storage/Db without booting a Tauri `AppHandle`. Not part of
/// the public API.
#[doc(hidden)]
pub mod perf_helpers {
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use crate::db::Db;
    use crate::storage::Storage;

    /// Mirrors what `AppState::initialize` does for the vault
    /// layout — stays a single source of truth so tests don't drift
    /// when the expected subdirs change.
    pub fn fresh_vault(root: &Path) {
        crate::config::bootstrap_vault(root).expect("bootstrap_vault");
    }

    pub fn open_db(path: &Path) -> Db {
        Db::open(path).expect("open DB")
    }

    pub fn storage(vault: PathBuf, db: Arc<Db>) -> Arc<Storage> {
        Arc::new(Storage::new(vault, db))
    }
}

/// Wired with every IPC command and event so `run()` and any future
/// stand-alone exporter share one command list.
pub fn build_specta() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            calendar::calendar_status,
            calendar::calendar_begin,
            calendar::calendar_complete,
            calendar::calendar_cancel,
            calendar::calendar_sync,
            calendar::calendar_disconnect,
            board::board_load,
            board::board_save,
            board::board_export_recovery,
            desktop::desktop_diagnostic,
            desktop::desktop_diagnostic_info,
            desktop::desktop_flush_result,
            desktop::desktop_flush_started,
            desktop::desktop_recovery_response,
            library::library_import_audio,
            library::library_recognition,
            library::library_enrollment_candidates,
            library::library_enroll_selected_turns,
            library::library_voice_profiles,
            library::library_voice_profiles_page,
            library::library_person_samples_page,
            library::library_person_samples,
            library::library_revoke_voice_sample,
            library::library_voice_comparison,
            library::library_participant_context,
            library::library_set_participant_context,
            library::library_sessions,
            library::library_session,
            library::library_create_session,
            library::library_update_session,
            library::library_ensure_personal_note,
            library::library_start_session,
            library::library_list,
            library::library_sources,
            library::library_start,
            library::library_status,
            library::library_pause,
            library::library_stop,
            library::library_detail,
            library::library_recover,
            library::library_process,
            library::library_processing,
            library::library_create_person,
            library::library_confirm_speaker,
            library::library_revoke_assignment,
            library::library_edit_segment,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::list_notes,
            commands::get_note,
            commands::search_notes,
            commands::list_meetings,
            commands::get_meeting,
            commands::start_recording,
            commands::stop_recording,
            commands::transcribe_meeting,
            commands::summarize_meeting,
            commands::get_active_calls,
            call_detector::set_call_detection_enabled,
            call_detector::call_detection_status,
            auto_record::auto_record_status,
            auto_record::set_auto_record,
            auto_record::auto_record_keep,
            commands::save_attachment,
            commands::get_config,
            commands::update_config,
            commands::list_obsidian_vaults,
            commands::get_or_create_daily_note,
            commands::get_backlinks,
            commands::rebuild_from_vault,
            commands::list_tags,
            commands::list_notes_by_tag,
        ])
        .events(tauri_specta::collect_events![
            events::Navigate,
            events::CallDetected,
            events::CaptureChanged,
            events::RecordingProgress,
            events::TranscriptionProgress,
        ])
}

/// Write `src/lib/bindings.ts` from the specta Builder, but **only
/// if the generated content differs from what's on disk**. A naive
/// unconditional write fires Vite's HMR on every `cargo run` even
/// when nothing changed — and during dev that can race with
/// in-flight IPC calls by reloading types mid-flight.
#[cfg(all(debug_assertions, dev))]
fn export_bindings_if_changed(builder: &tauri_specta::Builder<tauri::Wry>) {
    use specta_typescript::{BigIntExportBehavior, Typescript};
    use std::fs;
    use std::path::Path;

    let lang = Typescript::default()
        .bigint(BigIntExportBehavior::Number)
        .header("// @ts-nocheck\n/* eslint-disable */\n");
    let new_content = match builder.export_str(lang) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("specta export failed: {e}");
            return;
        }
    };

    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/bindings.ts");
    if let Ok(existing) = fs::read_to_string(&path) {
        if existing == new_content {
            return;
        }
    }
    if let Err(e) = fs::write(&path, new_content) {
        tracing::warn!("failed to write {}: {e}", path.display());
    }
}

/// Seed `rust-i18n` with the OS locale before the tray menu or any
/// other `t!(...)` call runs. The persisted config may override this
/// later during `AppState::initialize`.
fn set_initial_locale() {
    if let Some(locale) = sys_locale::get_locale() {
        rust_i18n::set_locale(&normalize_locale(&locale));
    }
}

/// Trim a BCP-47 tag down to the base language when a region-specific
/// catalog isn't available (`en-US` → `en`). `rust-i18n` already falls
/// back via the `fallback = "en"` directive, but normalizing here
/// avoids one failed lookup per key.
fn normalize_locale(raw: &str) -> String {
    raw.split(['-', '_']).next().unwrap_or("en").to_lowercase()
}

mod commands {
    use super::*;
    use crate::storage::Storage;
    use shared::*;
    use uuid::Uuid;

    #[tauri::command]
    #[specta::specta]
    pub async fn create_note(
        storage: tauri::State<'_, Arc<Storage>>,
        title: String,
        content: String,
    ) -> Result<Note, String> {
        storage
            .create_note(&title, &content)
            .await
            .map_err(crate::note_errors::ipc_error)
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn update_note(
        storage: tauri::State<'_, Arc<Storage>>,
        id: Uuid,
        content: String,
    ) -> Result<Note, String> {
        storage
            .update_note(id, &content)
            .await
            .map_err(crate::note_errors::ipc_error)
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn delete_note(
        storage: tauri::State<'_, Arc<Storage>>,
        library: tauri::State<'_, library::Library>,
        id: Uuid,
    ) -> Result<(), String> {
        library.delete_note(storage.inner().clone(), id).await
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn list_notes(storage: tauri::State<'_, Arc<Storage>>) -> Result<Vec<Note>, String> {
        storage.list_notes().await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn get_note(
        storage: tauri::State<'_, Arc<Storage>>,
        id: Uuid,
    ) -> Result<NoteContent, String> {
        storage
            .get_note(id)
            .await
            .map_err(crate::note_errors::ipc_error)
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn search_notes(
        storage: tauri::State<'_, Arc<Storage>>,
        query: String,
    ) -> Result<Vec<Note>, String> {
        storage
            .search_notes(&query)
            .await
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn list_meetings(
        storage: tauri::State<'_, Arc<Storage>>,
    ) -> Result<Vec<Meeting>, String> {
        storage.list_meetings().await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn get_meeting(
        storage: tauri::State<'_, Arc<Storage>>,
        id: Uuid,
    ) -> Result<Meeting, String> {
        storage.get_meeting(id).await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn start_recording(
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
        title: String,
    ) -> Result<Uuid, String> {
        let mut state = state.lock().await;
        state
            .recorder
            .start(&title)
            .await
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn stop_recording(
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
    ) -> Result<Meeting, String> {
        let mut state = state.lock().await;
        state.recorder.stop().await.map_err(|e| e.to_string())
    }

    /// TODO(spec 0008): orchestrate recorder → transcriber → diarizer
    /// → write `transcript.json` → flip `has_transcript`. Left as a
    /// deliberate bail! so the IPC surface exists without pretending
    /// to work.
    #[tauri::command]
    #[specta::specta]
    pub async fn transcribe_meeting(
        _state: tauri::State<'_, Arc<Mutex<AppState>>>,
        _id: Uuid,
    ) -> Result<Transcript, String> {
        Err("transcribe_meeting is not wired yet (see spec 0008)".into())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn summarize_meeting(
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
        id: Uuid,
    ) -> Result<String, String> {
        let state = state.lock().await;
        state
            .summarizer
            .summarize_meeting(id)
            .await
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn get_active_calls(
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
    ) -> Result<Vec<ActiveCall>, String> {
        let state = state.lock().await;
        Ok(state.active_calls.clone())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn save_attachment(
        storage: tauri::State<'_, Arc<Storage>>,
        filename: String,
        bytes: Vec<u8>,
    ) -> Result<String, String> {
        storage
            .save_attachment(&filename, &bytes)
            .await
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn get_config(
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
    ) -> Result<AppConfig, String> {
        let state = state.lock().await;
        Ok(state.config.clone())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn update_config(
        state: tauri::State<'_, Arc<Mutex<AppState>>>,
        config: AppConfig,
    ) -> Result<(), String> {
        let mut state = state.lock().await;
        state.update_config(config).await.map_err(|e| e.to_string())
    }

    /// Settings (spec 0037) calls this to populate the "Adopt an
    /// Obsidian vault" picker. Returns `[]` when Obsidian isn't
    /// installed — never an error in that case.
    #[tauri::command]
    #[specta::specta]
    pub async fn list_obsidian_vaults() -> Result<Vec<ObsidianVault>, String> {
        crate::obsidian::detect_vaults().map_err(|e| e.to_string())
    }

    /// Returns today's daily note (or `date`'s, `YYYY-MM-DD`),
    /// creating the file from the default template on first use.
    /// Idempotent — the same day always resolves to the same `Note`.
    #[tauri::command]
    #[specta::specta]
    pub async fn get_or_create_daily_note(
        storage: tauri::State<'_, Arc<Storage>>,
        date: Option<String>,
    ) -> Result<Note, String> {
        storage
            .get_or_create_daily_note(date.as_deref())
            .await
            .map_err(crate::note_errors::ipc_error)
    }

    /// Notes that `[[…]]`-link to this one. Match is resolved
    /// against the target's current title and filename stem, so
    /// renames don't orphan backlinks (spec 0013).
    #[tauri::command]
    #[specta::specta]
    pub async fn get_backlinks(
        storage: tauri::State<'_, Arc<Storage>>,
        id: Uuid,
    ) -> Result<Vec<Note>, String> {
        storage.backlinks(id).await.map_err(|e| e.to_string())
    }

    /// Wipe the notes index and rebuild it by walking the current
    /// vault. Filesystem stays authoritative — the command makes
    /// the invariant operational for the "adopt an Obsidian vault"
    /// flow (spec 0037) and for disaster recovery when `index.db`
    /// is lost (spec 0005 acceptance).
    #[tauri::command]
    #[specta::specta]
    pub async fn rebuild_from_vault(
        storage: tauri::State<'_, Arc<Storage>>,
    ) -> Result<RebuildStats, String> {
        storage
            .rebuild_from_vault()
            .await
            .map_err(crate::note_errors::ipc_error)
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn list_tags(
        storage: tauri::State<'_, Arc<Storage>>,
    ) -> Result<Vec<TagCount>, String> {
        storage.list_tags().await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    #[specta::specta]
    pub async fn list_notes_by_tag(
        storage: tauri::State<'_, Arc<Storage>>,
        tag: String,
    ) -> Result<Vec<Note>, String> {
        storage
            .list_notes_by_tag(&tag)
            .await
            .map_err(|e| e.to_string())
    }
}
