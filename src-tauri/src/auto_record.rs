//! Opt-in automatic recording of detected calls (spec 0097, ADR 0023).
//! Runs next to the detector so it works with the window hidden in the tray.
use crate::library::Library;
use crate::storage::Storage;
use coxinha_core::store::session::NewSession;
use serde::Serialize;
use serde_json::{json, Value};
use shared::ActiveCall;
use specta::Type;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

mod plan;
mod policy;
pub use policy::Settings;
use policy::{Binding, Capture, Command, Policy};

pub struct AutoRecord {
    settings: Mutex<Settings>,
    policy: Mutex<Policy>,
    path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AutoRecordBinding {
    session_id: String,
    meeting_id: String,
    call: ActiveCall,
    keep: bool,
}
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AutoRecordStatus {
    settings: Settings,
    binding: Option<AutoRecordBinding>,
    /// Milliseconds until the pending automatic stop, if one is counting down.
    stop_in_ms: Option<u32>,
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
            binding: policy.binding.as_ref().map(|b| AutoRecordBinding {
                session_id: b.session.clone(),
                meeting_id: b.meeting.clone(),
                call: b.call.clone(),
                keep: b.keep,
            }),
            stop_in_ms: policy.stop_at.map(|at| {
                at.saturating_duration_since(Instant::now())
                    .as_millis()
                    .min(u32::MAX as u128) as u32
            }),
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
/// "Continuar gravando": the end of the bound call no longer stops it.
#[tauri::command]
#[specta::specta]
pub fn auto_record_keep(app: AppHandle, state: State<'_, AutoRecord>) -> AutoRecordStatus {
    lock(&state.policy).keep();
    changed(&app);
    state.status()
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
    let capture = if settings.enabled {
        let Ok(status) = app.state::<Library>().status_value().await else {
            return unreliable(app);
        };
        Capture {
            active: status["active"]["meetingId"].as_str().map(str::to_owned),
            busy: !status["processing"].is_null(),
        }
    } else {
        Capture::default()
    };
    let (command, moved) = {
        let mut policy = lock(&state.policy);
        let before = (policy.stop_at, policy.binding.is_some());
        let command = policy.observe(Instant::now(), &settings, calls, &capture);
        (
            command,
            before != (policy.stop_at, policy.binding.is_some()),
        )
    };
    if moved {
        changed(app);
    }
    if let Some(command) = command {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { execute(&app, command).await });
    }
}

async fn execute(app: &AppHandle, command: Command) {
    let (stop, start) = match command {
        Command::Start(call) => (None, Some(call)),
        Command::Stop(meeting) => (Some(meeting), None),
        Command::StopThenStart(meeting, call) => (Some(meeting), Some(call)),
    };
    if let Some(meeting) = stop {
        let library = app.state::<Library>();
        let still_ours = library
            .status_value()
            .await
            .is_ok_and(|s| s["active"]["meetingId"].as_str() == Some(meeting.as_str()));
        if still_ours && library.stop_capture().await.is_ok() {
            notify(
                app,
                rust_i18n::t!("autoRecord.stopped").to_string(),
                rust_i18n::t!("autoRecord.stoppedBody", app = app_label(&start, app)).to_string(),
            );
        }
    }
    let Some(call) = start else {
        changed(app);
        return;
    };
    let state = app.state::<AutoRecord>();
    match begin(app, &call).await {
        Ok((binding, title, named_by_event)) => {
            if !named_by_event {
                crate::titles::watch::watch(
                    app.clone(),
                    binding.session.clone(),
                    binding.meeting.clone(),
                    title.clone(),
                );
            }
            lock(&state.policy).started(binding);
            notify(
                app,
                rust_i18n::t!("autoRecord.started", title = title).to_string(),
                rust_i18n::t!("autoRecord.startedBody", app = call.app_name).to_string(),
            );
        }
        Err(error) => {
            tracing::warn!("automatic recording did not start: {error}");
            lock(&state.policy).start_failed();
            notify(
                app,
                rust_i18n::t!("autoRecord.failed").to_string(),
                rust_i18n::t!("autoRecord.failedBody", app = call.app_name).to_string(),
            );
        }
    }
    changed(app);
}

fn app_label(next: &Option<ActiveCall>, app: &AppHandle) -> String {
    let state = app.state::<AutoRecord>();
    let policy = lock(&state.policy);
    policy
        .binding
        .as_ref()
        .map(|b| b.call.app_name.clone())
        .or_else(|| next.as_ref().map(|c| c.app_name.clone()))
        .unwrap_or_else(|| "Teams".into())
}

async fn sources() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "linux")]
        {
            coxinha_core::capture::list_sources()
                .and_then(|s| Ok(serde_json::to_value(s)?))
                .map_err(|e| format!("{e:#}"))
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err::<Value, String>("capture adapter unavailable on this platform".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Devices, calendar title, session, start, invitees. Each step can fail
/// once; there is no retry loop and the strip prompt stays available.
async fn begin(app: &AppHandle, call: &ActiveCall) -> Result<(Binding, String, bool), String> {
    let settings = lock(&app.state::<AutoRecord>().settings).clone();
    let devices = sources().await?;
    let mic = plan::pick_source(&devices, false, settings.mic_source.as_deref())
        .ok_or("no microphone")?;
    let output = plan::pick_source(&devices, true, settings.output_source.as_deref())
        .ok_or("no computer audio")?;
    let snapshot = crate::calendar::calendar_status(app.clone()).unwrap_or_default();
    let event = plan::current_event(&snapshot.events, chrono::Utc::now()).cloned();
    let library = app.state::<Library>();
    let storage = app.state::<Arc<Storage>>().inner().clone();
    let reuse = match &event {
        Some(e) => plan::reusable_session(&library.session_list().await?, e),
        None => None,
    };
    let (session, title) = match (reuse, &event) {
        (Some(id), Some(e)) => (id, e.title.trim().to_owned()),
        _ => {
            let input = match &event {
                Some(e) => NewSession {
                    title: e.title.trim().to_owned(),
                    starts_at: plan::session_time(&e.starts_at),
                    ends_at: plan::session_time(&e.ends_at),
                    status: coxinha_core::store::session::SessionStatus::Planned,
                },
                None => NewSession::manual(
                    rust_i18n::t!("autoRecord.title", app = call.app_name).to_string(),
                ),
            };
            let title = input.title.clone();
            let created = library.create_session(&storage, input).await?;
            let id = created["id"].as_str().ok_or("session id missing")?;
            (id.to_owned(), title)
        }
    };
    let key = policy::call_key(call);
    let still = app
        .state::<crate::call_detector::Detector>()
        .active_calls()
        .iter()
        .any(|c| policy::call_key(c) == key);
    if !still {
        return Err("call ended before the capture started".into());
    }
    let started = library
        .start_session(&storage, &session, title.clone(), mic, output)
        .await?;
    let meeting = started["active"]["meetingId"]
        .as_str()
        .ok_or("capture was not acknowledged")?
        .to_owned();
    if let Some(e) = &event {
        let people = json!(plan::invitees(e));
        if let Err(error) = library.set_participants(&meeting, people).await {
            tracing::debug!("invitees not saved: {error}");
        }
    }
    let binding = Binding {
        call: call.clone(),
        meeting,
        session,
        keep: false,
    };
    Ok((binding, title, event.is_some()))
}
