//! Suggested titles for automatic captures (spec 0097 P4). The suggestion is
//! Memory (ADR 0015): stored with its source next to the live transcript and
//! applied only over the automatic placeholder (ADR 0024).
use super::{
    build_excerpt, estimate_tokens, suggest_title, ExcerptMode, TitleLlmSettings, TranscriptLine,
    FIRST_TITLE_MINUTES, MAX_EXCERPT_TOKENS,
};
use crate::library::Library;
use crate::storage::Storage;
use coxinha_core::capture::Track;
use coxinha_core::live::LiveSegment;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const POLL: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TitleSuggestion {
    pub title: String,
    pub placeholder: String,
    pub session_id: String,
    pub source: String,
    pub model: String,
    pub endpoint_host: String,
    pub at: String,
    pub input_tokens: u32,
    /// `first` (5 minutes) or `final` (after the drain).
    pub stage: String,
    pub applied: bool,
    pub dismissed: bool,
}

fn suggestion_path(root: &Path, meeting: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(meeting).map_err(|e| e.to_string())?;
    Ok(root
        .join("raw")
        .join(meeting)
        .join("outputs/live/title.json"))
}
fn read(root: &Path, meeting: &str) -> Option<TitleSuggestion> {
    let bytes = std::fs::read(suggestion_path(root, meeting).ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}
fn write(root: &Path, meeting: &str, value: &TitleSuggestion) -> Result<(), String> {
    crate::settings_file::save(&suggestion_path(root, meeting)?, value)
}
fn changed(app: &AppHandle) {
    let _ = tauri_specta::Event::emit(&crate::events::SessionsChanged::now(), app);
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::settings_file::app_file(app, "title-llm.json")
}
pub fn load_settings(app: &AppHandle) -> TitleLlmSettings {
    settings_path(app)
        .map(|p| crate::settings_file::load(&p))
        .unwrap_or_default()
}

pub fn lines(segments: &[LiveSegment]) -> Vec<TranscriptLine> {
    segments
        .iter()
        .map(|s| TranscriptLine {
            start_ms: s.start_ms,
            speaker_hint: Some(match s.track {
                Track::Mic => "me".into(),
                Track::Output => "others".into(),
            }),
            text: s.text.clone(),
        })
        .collect()
}

/// Follows one automatic capture: first title at 5 minutes, final after the drain.
pub fn watch(app: AppHandle, session: String, meeting: String, placeholder: String) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = follow(&app, &session, &meeting, &placeholder).await {
            tracing::warn!("title suggestion stopped: {error}");
        }
    });
}

async fn follow(
    app: &AppHandle,
    session: &str,
    meeting: &str,
    placeholder: &str,
) -> Result<(), String> {
    let mut first = false;
    loop {
        tokio::time::sleep(POLL).await;
        if !load_settings(app).enabled {
            return Ok(());
        }
        let library = app.state::<Library>();
        let live = library.live_transcript(meeting.to_owned()).await?;
        let segments: Vec<LiveSegment> =
            serde_json::from_value(live["segments"].clone()).map_err(|e| e.to_string())?;
        let recording = library
            .status_value()
            .await
            .map(|s| s["active"]["meetingId"].as_str() == Some(meeting))
            .unwrap_or(true);
        let covered = segments.iter().map(|s| s.end_ms).max().unwrap_or(0);
        if !first && covered >= FIRST_TITLE_MINUTES * 60_000 {
            first = true;
            let mode = ExcerptMode::FirstMinutes(FIRST_TITLE_MINUTES);
            suggest(app, session, meeting, placeholder, &segments, mode, "first").await;
        }
        let state = live["state"].as_str().unwrap_or("idle");
        if !recording && matches!(state, "idle" | "failed") {
            if !segments.is_empty() {
                suggest(
                    app,
                    session,
                    meeting,
                    placeholder,
                    &segments,
                    ExcerptMode::Sampled,
                    "final",
                )
                .await;
            }
            return Ok(());
        }
    }
}

async fn suggest(
    app: &AppHandle,
    session: &str,
    meeting: &str,
    placeholder: &str,
    segments: &[LiveSegment],
    mode: ExcerptMode,
    stage: &str,
) {
    let library = app.state::<Library>();
    let root = library.live_root().to_path_buf();
    let previous = read(&root, meeting);
    if previous.as_ref().is_some_and(|p| p.dismissed) {
        return;
    }
    let settings = load_settings(app);
    let excerpt = build_excerpt(&lines(segments), mode, MAX_EXCERPT_TOKENS);
    let title = match suggest_title(&settings, &excerpt).await {
        Ok(title) => title,
        Err(error) => return tracing::warn!("title suggestion failed: {error}"),
    };
    // Replace only the automatic title in place: the placeholder or our last suggestion.
    let expected = previous
        .filter(|p| p.applied)
        .map(|p| p.title)
        .unwrap_or_else(|| placeholder.to_owned());
    let storage = app.state::<Arc<Storage>>().inner().clone();
    let applied = library
        .retitle_if(&storage, session, &expected, &title)
        .await
        .unwrap_or(false);
    let record = TitleSuggestion {
        title,
        placeholder: placeholder.to_owned(),
        session_id: session.to_owned(),
        source: "llm".into(),
        model: settings.model.clone(),
        endpoint_host: settings
            .ssh_target
            .rsplit('@')
            .next()
            .unwrap_or_default()
            .to_owned(),
        at: chrono::Utc::now().to_rfc3339(),
        input_tokens: estimate_tokens(&excerpt) as u32,
        stage: stage.into(),
        applied,
        dismissed: false,
    };
    if let Err(error) = write(&root, meeting, &record) {
        tracing::warn!("title suggestion not saved: {error}");
    }
    if applied {
        changed(app);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn title_llm_settings(app: AppHandle) -> Result<TitleLlmSettings, String> {
    Ok(load_settings(&app))
}
#[tauri::command]
#[specta::specta]
pub async fn set_title_llm_settings(
    app: AppHandle,
    settings: TitleLlmSettings,
) -> Result<TitleLlmSettings, String> {
    settings.validate()?;
    crate::settings_file::save(&settings_path(&app)?, &settings)?;
    Ok(settings)
}
/// "Testar": a fixed synthetic excerpt, never meeting content.
#[tauri::command]
#[specta::specta]
pub async fn title_llm_test(settings: TitleLlmSettings) -> Result<String, String> {
    let sample = "[00:00 others] Bom dia. A pauta de hoje é o orçamento de infraestrutura do próximo trimestre.\n[00:20 me] Precisamos decidir entre renovar os servidores ou migrar parte para a nuvem.";
    suggest_title(
        &TitleLlmSettings {
            enabled: true,
            ..settings
        },
        sample,
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_title_suggestion(
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<Option<TitleSuggestion>, String> {
    suggestion_path(state.live_root(), &meeting_id)?;
    Ok(read(state.live_root(), &meeting_id))
}
/// "Desfazer": back to the placeholder, and no later suggestion is applied.
#[tauri::command]
#[specta::specta]
pub async fn library_dismiss_title_suggestion(
    app: AppHandle,
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
    meeting_id: String,
) -> Result<Option<TitleSuggestion>, String> {
    let root = state.live_root().to_path_buf();
    let Some(mut record) = read(&root, &meeting_id) else {
        return Ok(None);
    };
    if record.applied {
        state
            .retitle_if(
                storage.inner(),
                &record.session_id,
                &record.title,
                &record.placeholder,
            )
            .await?;
    }
    record.applied = false;
    record.dismissed = true;
    write(&root, &meeting_id, &record)?;
    changed(&app);
    Ok(Some(record))
}
