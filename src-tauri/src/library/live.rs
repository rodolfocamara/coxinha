//! Live transcript slot (spec 0097 P3). The actor only spawns and sends
//! messages; model load, hashing and file I/O happen on the worker thread.
use super::*;
#[cfg(not(feature = "stt-tagarela"))]
use coxinha_core::live::Asr;
use coxinha_core::live::{AsrFactory, EndState, LiveTranscriber};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveSettings {
    pub enabled: bool,
    pub model_path: String,
    pub n_threads: u32,
}
impl Default for LiveSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            model_path: String::new(),
            n_threads: 4,
        }
    }
}

/// Read by IPC for snapshots without going through the actor (review N4).
pub type SharedLive = Arc<Mutex<Option<Arc<LiveTranscriber>>>>;

/// Builds without the runtime still run the app; live transcription fails visibly.
#[cfg(not(feature = "stt-tagarela"))]
struct Unavailable;
#[cfg(not(feature = "stt-tagarela"))]
impl AsrFactory for Unavailable {
    fn load(&self) -> anyhow::Result<Box<dyn Asr>> {
        anyhow::bail!("Tagarela runtime not built; enable the stt-tagarela feature")
    }
}

fn factory(settings: &LiveSettings) -> Arc<dyn AsrFactory> {
    #[cfg(feature = "stt-tagarela")]
    {
        Arc::new(coxinha_core::live::TagarelaFactory::new(
            settings.model_path.clone().into(),
            settings.n_threads.clamp(1, 16),
        ))
    }
    #[cfg(not(feature = "stt-tagarela"))]
    {
        let _ = settings;
        Arc::new(Unavailable)
    }
}

#[derive(Default)]
pub(super) struct LiveSlot {
    settings: LiveSettings,
    transcriber: Option<(LiveSettings, Arc<LiveTranscriber>)>,
    pub(super) shared: SharedLive,
}
impl LiveSlot {
    fn publish(&self) {
        *self.shared.lock().unwrap_or_else(|e| e.into_inner()) =
            self.transcriber.as_ref().map(|(_, t)| t.clone());
    }
    pub(super) fn configure(&mut self, settings: LiveSettings) {
        self.settings = settings;
        // A model change applies once the current queue has drained.
        if self
            .transcriber
            .as_ref()
            .is_some_and(|(used, t)| *used != self.settings && !t.is_busy())
        {
            if let Some((_, t)) = self.transcriber.take() {
                t.cancel();
            }
            self.publish();
        }
    }
    pub(super) fn started(&mut self, root: &std::path::Path, meeting: &str) {
        if !self.settings.enabled || self.settings.model_path.trim().is_empty() {
            return;
        }
        let stale = self
            .transcriber
            .as_ref()
            .is_some_and(|(used, t)| *used != self.settings && !t.is_busy());
        if stale || self.transcriber.is_none() {
            if let Some((_, old)) = self.transcriber.take() {
                old.cancel();
            }
            let t = LiveTranscriber::spawn(root.to_path_buf(), factory(&self.settings));
            self.transcriber = Some((self.settings.clone(), Arc::new(t)));
            self.publish();
        }
        if let Some((_, t)) = &self.transcriber {
            // "Pausar transcrição" applies to one meeting; a new capture starts unpaused.
            t.pause(false);
            t.enqueue(meeting);
        }
    }
    pub(super) fn committed(&self, meeting: &str) {
        if let Some((_, t)) = &self.transcriber {
            t.committed(meeting);
        }
    }
    pub(super) fn ended(&self, meeting: &str, state: EndState) {
        if let Some((_, t)) = &self.transcriber {
            t.end(meeting, state);
        }
    }
    /// "Transcrever o resto": queue a finished meeting from its last segment.
    pub(super) fn resume(&mut self, root: &std::path::Path, meeting: &str) {
        self.started(root, meeting);
        self.ended(meeting, EndState::Finished);
    }
    pub(super) fn pause(&self, paused: bool) {
        if let Some((_, t)) = &self.transcriber {
            t.pause(paused);
        }
    }
    pub(super) fn busy(&self) -> bool {
        self.transcriber.as_ref().is_some_and(|(_, t)| t.is_busy())
    }
    /// Before manual processing: an idle but loaded model leaves now, so at
    /// most one ASR model is resident (review S5).
    pub(super) fn release_idle(&mut self) {
        if self.transcriber.as_ref().is_some_and(|(_, t)| !t.is_busy()) {
            self.shutdown();
        }
    }
    /// Exit: cancel, then the 250 ms grace of spec 0089. A run still inside the
    /// engine is not joined; the worker never touches the Store, so it counts
    /// as a crash for the dedupe-on-read rule.
    pub(super) fn shutdown(&mut self) {
        if let Some((_, t)) = self.transcriber.take() {
            t.cancel();
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(250);
            while !t.is_finished() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        self.publish();
    }
}

impl Worker {
    pub(super) fn live_action(&mut self, action: Action) -> anyhow::Result<Value> {
        match action {
            Action::LiveConfigure(settings) => self.live.configure(settings),
            Action::LivePause(paused) => self.live.pause(paused),
            Action::LiveResume(meeting) => {
                uuid::Uuid::parse_str(&meeting)?;
                // Backfill never queues ahead of a live call (review S5).
                #[cfg(target_os = "linux")]
                anyhow::ensure!(
                    self.active.is_none(),
                    "finish the recording before transcribing the rest"
                );
                self.live.resume(&self.root, &meeting);
            }
            _ => unreachable!("non-live action dispatched to the live slot"),
        }
        Ok(Value::Null)
    }
}

impl Library {
    pub(crate) async fn configure_live(&self, settings: LiveSettings) -> Result<Value, String> {
        self.ask(Action::LiveConfigure(settings)).await
    }
    /// Segments are read from disk off the actor; the state comes from the shared snapshot.
    pub(crate) async fn live_transcript(&self, meeting: String) -> Result<Value, String> {
        uuid::Uuid::parse_str(&meeting).map_err(|e| e.to_string())?;
        let root = self.root.clone();
        let transcriber = self.live.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let id = meeting.clone();
        let (segments, complete) = tauri::async_runtime::spawn_blocking(move || {
            let segments =
                coxinha_core::live::read_transcript(&root, &id).map_err(|e| format!("{e:#}"))?;
            Ok::<_, String>((segments, transcript_complete(&root, &id)))
        })
        .await
        .map_err(|e| e.to_string())??;
        let snapshot = transcriber.map(|t| t.snapshot()).unwrap_or_default();
        let mine = snapshot.meeting.as_deref() == Some(meeting.as_str());
        let queued = snapshot.queued.iter().any(|m| m == &meeting);
        Ok(json!({
            "segments": segments,
            "state": if mine { snapshot.state.as_str() } else if queued { "queued" } else { "idle" },
            "error": if mine { snapshot.error.clone() } else { None },
            "behindMs": if mine { snapshot.behind_ms } else { 0 },
            "paused": snapshot.state == "paused",
            "complete": complete,
        }))
    }
    pub(crate) fn live_root(&self) -> &std::path::Path {
        &self.root
    }
}

/// Both tracks transcribed up to their committed frames (silence included).
fn transcript_complete(root: &std::path::Path, meeting: &str) -> bool {
    use coxinha_core::capture::{CommittedTrack, Track};
    let Ok(progress) = coxinha_core::live::transcript_progress(root, meeting) else {
        return false;
    };
    [Track::Mic, Track::Output]
        .iter()
        .zip(progress)
        .all(|(track, done)| {
            CommittedTrack::open(root, meeting, *track).is_ok_and(|t| done >= t.frames())
        })
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::settings_file::app_file(app, "live-transcription.json")
}
pub fn load_live_settings(app: &tauri::AppHandle) -> LiveSettings {
    settings_path(app)
        .map(|p| crate::settings_file::load(&p))
        .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub async fn live_settings(app: tauri::AppHandle) -> Result<LiveSettings, String> {
    Ok(load_live_settings(&app))
}
#[tauri::command]
#[specta::specta]
pub async fn set_live_settings(
    app: tauri::AppHandle,
    state: State<'_, Library>,
    settings: LiveSettings,
) -> Result<LiveSettings, String> {
    crate::settings_file::save(&settings_path(&app)?, &settings)?;
    state.configure_live(settings.clone()).await?;
    Ok(settings)
}
#[tauri::command]
#[specta::specta]
pub async fn library_live_transcript(
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<Value, String> {
    state.live_transcript(meeting_id).await
}
/// Strip status: the shared snapshot only, no file reads (polled with capture).
#[tauri::command]
#[specta::specta]
pub fn library_live_status(state: State<'_, Library>) -> Value {
    let transcriber = state.live.lock().unwrap_or_else(|e| e.into_inner()).clone();
    json!(transcriber.map(|t| t.snapshot()).unwrap_or_default())
}
#[tauri::command]
#[specta::specta]
pub async fn library_live_pause(state: State<'_, Library>, paused: bool) -> Result<Value, String> {
    state.ask(Action::LivePause(paused)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_live_resume(
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<Value, String> {
    state.ask(Action::LiveResume(meeting_id)).await
}
