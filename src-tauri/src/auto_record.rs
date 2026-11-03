//! Recordings that follow their call (spec 0118) and opt-in automatic
//! recording of detected calls (spec 0097, ADR 0023). Runs next to the
//! detector so it works with the window hidden in the tray.
use crate::library::Library;
use serde::Serialize;
use shared::ActiveCall;
use specta::Type;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

mod execute;
pub(crate) mod plan;
mod policy;
pub use policy::Settings;
use policy::{Capture, Policy};

pub struct AutoRecord {
    settings: Mutex<Settings>,
    policy: Mutex<Policy>,
    /// The last capture stopped with its call, for the strip line.
    ended: Mutex<Option<EndedWithCall>>,
    path: PathBuf,
}

/// The live capture and the calls it follows.
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AutoRecordBinding {
    /// Set when automatic recording started the capture.
    session_id: Option<String>,
    meeting_id: String,
    calls: Vec<ActiveCall>,
    keep: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EndedWithCall {
    meeting_id: String,
    app: String,
}
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AutoRecordStatus {
    settings: Settings,
    binding: Option<AutoRecordBinding>,
    /// Milliseconds until the pending automatic stop, if one is counting down.
    stop_in_ms: Option<u32>,
    ended: Option<EndedWithCall>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AutoRecord {
    pub fn load(path: PathBuf) -> Self {
        let settings = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            settings: Mutex::new(settings),
            policy: Mutex::default(),
            ended: Mutex::default(),
            path,
        }
    }
    pub fn enabled(&self) -> bool {
        lock(&self.settings).enabled
    }
    fn save(&self, settings: &Settings) -> Result<(), String> {
        let parent = self.path.parent().ok_or("auto-record path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, settings).map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(&self.path).map_err(|e| e.to_string())?;
        Ok(())
    }
    fn status(&self) -> AutoRecordStatus {
        let policy = lock(&self.policy);
        AutoRecordStatus {
            settings: lock(&self.settings).clone(),
            binding: policy.follow.as_ref().map(|f| AutoRecordBinding {
                session_id: f.session.clone(),
                meeting_id: f.meeting.clone(),
                calls: f.calls.clone(),
                keep: f.keep,
            }),
            stop_in_ms: policy.stop_at.map(|at| {
                at.saturating_duration_since(Instant::now())
                    .as_millis()
                    .min(u32::MAX as u128) as u32
            }),
            ended: lock(&self.ended).clone(),
        }
    }
}

fn changed(app: &AppHandle) {
    let _ = tauri_specta::Event::emit(&crate::events::CaptureChanged::now(), app);
}
fn notify(app: &AppHandle, title: String, body: String) {
    if app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .is_err()
    {
        tracing::debug!("auto-record notification unavailable");
    }
}

#[tauri::command]
#[specta::specta]
pub fn auto_record_status(state: State<'_, AutoRecord>) -> AutoRecordStatus {
    state.status()
}
#[tauri::command]
#[specta::specta]
pub fn set_auto_record(
    app: AppHandle,
    state: State<'_, AutoRecord>,
    settings: Settings,
) -> Result<AutoRecordStatus, String> {
    state.save(&settings)?;
    if settings.enabled {
        app.state::<crate::call_detector::Detector>()
            .enable_for_auto_record();
    }
    *lock(&state.settings) = settings;
    changed(&app);
    Ok(state.status())
}
/// "Continuar gravando": the end of the followed calls no longer stops it.
#[tauri::command]
#[specta::specta]
pub fn auto_record_keep(app: AppHandle, state: State<'_, AutoRecord>) -> AutoRecordStatus {
    lock(&state.policy).keep();
    changed(&app);
    state.status()
}

/// Whether the capture stops by itself (spec 0118) when one of these calls ends.
pub fn stops_on_end(app: &AppHandle, calls: &[ActiveCall]) -> bool {
    let Some(state) = app.try_state::<AutoRecord>() else {
        return false;
    };
    let settings = lock(&state.settings).clone();
    let stops = lock(&state.policy).stops_on_end(&settings, calls);
    stops
}

/// A failed detector poll: evidence is unreliable, cancel any countdown.
pub fn unreliable(app: &AppHandle) {
    let Some(state) = app.try_state::<AutoRecord>() else {
        return;
    };
    let mut policy = lock(&state.policy);
    if policy.stop_at.is_some() {
        policy.unreliable();
        drop(policy);
        changed(app);
    }
}

/// Called after every successful detector poll with the active episodes.
pub async fn observe(app: &AppHandle, calls: &[ActiveCall]) {
    let Some(state) = app.try_state::<AutoRecord>() else {
        return;
    };
    let settings = lock(&state.settings).clone();
    let Ok(status) = app.state::<Library>().status_value().await else {
        return unreliable(app);
    };
    let capture = capture(&status);
    if capture.active.is_some() {
        lock(&state.ended).take();
    }
    let (command, moved) = {
        let mut policy = lock(&state.policy);
        let shape = |p: &Policy| {
            (
                p.stop_at,
                p.follow.as_ref().map(|f| (f.calls.len(), f.keep)),
            )
        };
        let before = shape(&policy);
        let command = policy.observe(Instant::now(), &settings, calls, &capture);
        (command, before != shape(&policy))
    };
    if moved {
        changed(app);
    }
    if let Some(command) = command {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { execute::execute(&app, command).await });
    }
}

fn capture(status: &serde_json::Value) -> Capture {
    Capture {
        active: status["active"]["meetingId"].as_str().map(str::to_owned),
        speech_ago: status["active"]["mic"]["speechAgoMs"]
            .as_u64()
            .map(Duration::from_millis),
    }
}
