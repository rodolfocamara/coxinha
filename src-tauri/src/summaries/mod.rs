//! Meeting summaries from the owner's LLM (spec 0108, ADR 0024). A
//! background loop summarizes new transcripts one at a time; the meeting
//! page can ask for one on demand. A summary is Memory (ADR 0015): it keeps
//! the job and transcript hash it came from.
use crate::library::{Library, MeetingSummary, StoredSummaryInput, SummarySource};
use crate::titles::{self, watch::load_settings, TitleLlmSettings, TranscriptLine};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

mod generate;
pub mod prompt;
pub use generate::{backoff, summarize, SummaryError};

const FIRST_LOOK: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_secs(60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// One summary at a time, whether the loop or the owner asked for it.
static RUNNING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Summaries need both the title endpoint and their own opt-in.
pub fn allowed(settings: &TitleLlmSettings) -> bool {
    settings.enabled && settings.summaries
}

fn lines(source: &SummarySource) -> Vec<TranscriptLine> {
    source
        .lines
        .iter()
        .map(|(start_ms, speaker, text)| TranscriptLine {
            start_ms: *start_ms,
            speaker_hint: Some(speaker.clone()),
            text: text.clone(),
        })
        .collect()
}

async fn produce(
    library: &Library,
    settings: &TitleLlmSettings,
    source: SummarySource,
) -> Result<MeetingSummary, SummaryError> {
    let markdown = summarize(&lines(&source), |p| async move {
        titles::chat(settings, &p.system, &p.user, p.max_tokens, REQUEST_TIMEOUT).await
    })
    .await?;
    let generated_at = chrono::Utc::now().to_rfc3339();
    library
        .save_summary(StoredSummaryInput {
            meeting_id: source.meeting_id,
            job_id: source.job_id,
            markdown: markdown.clone(),
            model: settings.model.clone(),
            generated_at: generated_at.clone(),
            source_sha256: source.source_sha256,
        })
        .await
        .map_err(SummaryError::Transport)?;
    Ok(MeetingSummary {
        markdown,
        generated_at,
    })
}

/// Meetings whose last attempt failed wait `backoff(failures)`.
#[derive(Default)]
pub struct Retry {
    failed: HashMap<String, (u32, Instant)>,
}

impl Retry {
    pub fn waiting(&self, now: Instant) -> Vec<String> {
        self.failed
            .iter()
            .filter(|(_, (failures, at))| now < *at + backoff(*failures))
            .map(|(meeting, _)| meeting.clone())
            .collect()
    }
    pub fn failed(&mut self, meeting: &str, now: Instant) {
        let entry = self.failed.entry(meeting.to_string()).or_insert((0, now));
        *entry = (entry.0 + 1, now);
    }
    pub fn succeeded(&mut self, meeting: &str) {
        self.failed.remove(meeting);
    }
}

/// Summarizes every transcript that needs it, newest first, then sleeps.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_LOOK).await;
        let mut retry = Retry::default();
        loop {
            let settings = load_settings(&app);
            if allowed(&settings) {
                drain(&app, &settings, &mut retry).await;
            }
            tokio::time::sleep(POLL).await;
        }
    });
}

async fn drain(app: &AppHandle, settings: &TitleLlmSettings, retry: &mut Retry) {
    let library = app.state::<Library>().inner().clone();
    loop {
        let _turn = RUNNING.lock().await;
        let source = match library
            .next_summary_source(retry.waiting(Instant::now()))
            .await
        {
            Ok(Some(source)) => source,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(%error, "summary queue unavailable");
                return;
            }
        };
        let meeting = source.meeting_id.clone();
        match produce(&library, settings, source).await {
            Ok(_) => retry.succeeded(&meeting),
            Err(error) => {
                // Logged without content: the error never quotes the transcript.
                tracing::warn!(%meeting, %error, "summary failed");
                retry.failed(&meeting, Instant::now());
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn library_meeting_summary(
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<Option<MeetingSummary>, String> {
    state.summary(meeting_id).await
}

/// "Gerar resumo" / "Gerar de novo": same opt-in as the loop.
#[tauri::command]
#[specta::specta]
pub async fn library_summarize(
    app: AppHandle,
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<MeetingSummary, String> {
    let settings = load_settings(&app);
    if !allowed(&settings) {
        return Err("summaries are off: turn on the title model and \"Gerar resumos\"".into());
    }
    let library = state.inner().clone();
    let _turn = RUNNING.lock().await;
    let source = library.summary_source(meeting_id).await?;
    produce(&library, &settings, source)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
