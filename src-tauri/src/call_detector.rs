//! Local metadata-only call hints. Detection never opens an audio input or records.
use serde::{Deserialize, Serialize};
use shared::ActiveCall;
use specta::Type;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tauri_specta::Event;
use tokio::sync::Notify;

mod episodes;
#[cfg(target_os = "linux")]
mod linux;

#[derive(Clone, Debug)]
struct Candidate {
    pid: u32,
    process_name: String,
    app_name: String,
    is_browser: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DetectionStatus {
    enabled: bool,
    supported: bool,
    unavailable: bool,
    calls: Vec<ActiveCall>,
}
pub struct Detector {
    status: Mutex<DetectionStatus>,
    generation: AtomicU64,
    stop: Notify,
}
impl Default for Detector {
    fn default() -> Self {
        Self {
            status: Mutex::new(DetectionStatus {
                enabled: false,
                supported: cfg!(target_os = "linux"),
                unavailable: false,
                calls: vec![],
            }),
            generation: AtomicU64::new(0),
            stop: Notify::new(),
        }
    }
}
impl Detector {
    fn status(&self) -> std::sync::MutexGuard<'_, DetectionStatus> {
        self.status.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn stop(&self) {
        self.stop.notify_one();
    }
    /// Auto-record needs detection (ADR 0023); the frontend toggle follows.
    pub fn enable_for_auto_record(&self) {
        self.set_enabled(true);
    }
    pub fn active_calls(&self) -> Vec<ActiveCall> {
        self.status().calls.clone()
    }
    fn set_enabled(&self, enabled: bool) -> DetectionStatus {
        let mut status = self.status();
        if status.enabled != enabled {
            self.generation.fetch_add(1, Ordering::SeqCst);
            status.enabled = enabled;
            status.calls.clear();
            status.unavailable = false;
        }
        status.clone()
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_call_detection_enabled(state: State<'_, Detector>, enabled: bool) -> DetectionStatus {
    state.set_enabled(enabled)
}
#[tauri::command]
#[specta::specta]
pub fn call_detection_status(state: State<'_, Detector>) -> DetectionStatus {
    state.status().clone()
}

pub async fn run_loop(app: AppHandle) -> anyhow::Result<()> {
    let control = app.state::<Detector>();
    let mut tick = tokio::time::interval(Duration::from_secs(3));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut episodes = episodes::Episodes::default();
    let mut generation = control.generation.load(Ordering::SeqCst);
    let mut previous: Vec<ActiveCall> = Vec::new();
    loop {
        tokio::select! { _ = control.stop.notified() => return Ok(()), _ = tick.tick() => {} }
        let observed = control.generation.load(Ordering::SeqCst);
        if generation != observed {
            episodes = Default::default();
            generation = observed;
        }
        if !control.status().enabled {
            continue;
        }
        #[cfg(target_os = "linux")]
        let result = tokio::select! { _ = control.stop.notified() => return Ok(()), result = linux::poll() => result };
        #[cfg(not(target_os = "linux"))]
        let result: anyhow::Result<Vec<Candidate>> = Ok(vec![]);
        let (active, newly_detected) = {
            let mut status = control.status();
            if !status.enabled || control.generation.load(Ordering::SeqCst) != observed {
                continue;
            }
            match result {
                Ok(candidates) => {
                    status.unavailable = false;
                    let (active, new) = episodes.observe(candidates);
                    status.calls = active.clone();
                    (active, new)
                }
                Err(_) => {
                    status.unavailable = true;
                    episodes.failed();
                    drop(status);
                    crate::auto_record::unreliable(&app);
                    continue;
                }
            }
        };
        // Spec 0114: the app label and process only, never titles or stream contents.
        for ended in previous.iter().filter(|p| !active.contains(p)) {
            tracing::info!(app = %ended.app_name, pid = ended.pid, "call ended");
        }
        for started in active.iter().filter(|c| !previous.contains(c)) {
            tracing::info!(app = %started.app_name, pid = started.pid, browser = started.is_browser, "call detected");
        }
        let ended: Vec<ActiveCall> = previous
            .iter()
            .filter(|p| !active.contains(p))
            .cloned()
            .collect();
        previous = active.clone();
        if !ended.is_empty() && active.is_empty() {
            call_ended(&app, &ended).await;
        }
        crate::auto_record::observe(&app, &active).await;
        if let Some(state) = app.try_state::<Arc<tokio::sync::Mutex<crate::config::AppState>>>() {
            let mut state = state.lock().await;
            if state.active_calls != active {
                state.active_calls = active;
            }
        }
        for call in newly_detected {
            if control.generation.load(Ordering::SeqCst) != observed {
                break;
            }
            let _ = crate::events::CallDetected {
                app_name: call.app_name.clone(),
                process_name: call.process_name,
            }
            .emit(&app);
            // Only the fixed app label is used, never window titles, URLs or stream contents.
            if app
                .notification()
                .builder()
                .title(rust_i18n::t!("callDetection.title").to_string())
                .body(rust_i18n::t!("callDetection.body", app = call.app_name).to_string())
                .show()
                .is_err()
            {
                tracing::debug!("Meeting reminder notification unavailable");
            }
        }
    }
}

/// Spec 0115 P1: while a capture runs, the last call closing asks the owner
/// natively. The strip prompt alone goes unseen with the window hidden or
/// behind the call, where the compositor refuses focus.
fn asks_to_stop(
    ended: &[ActiveCall],
    active: &[ActiveCall],
    recording: bool,
    auto_stops: bool,
) -> bool {
    recording && !auto_stops && !ended.is_empty() && active.is_empty()
}

async fn call_ended(app: &AppHandle, ended: &[ActiveCall]) {
    let recording = app
        .state::<crate::library::Library>()
        .status_value()
        .await
        .is_ok_and(|s| !s["active"]["meetingId"].is_null());
    let auto_stops = crate::auto_record::stops_on_end(app, ended);
    if !asks_to_stop(ended, &[], recording, auto_stops) {
        return;
    }
    // Only the fixed app label is used, never window titles, URLs or stream contents.
    let title = rust_i18n::t!("callDetection.endedTitle").to_string();
    let body = rust_i18n::t!("callDetection.endedBody", app = ended[0].app_name).to_string();
    tracing::info!(app = %ended[0].app_name, "asking whether the recording should stop");
    if let Err(e) = notify_ended(app, title, body).await {
        tracing::warn!(error = %e, "call ended notification unavailable");
    }
    crate::window::show_main(app);
    crate::window::request_attention(app);
}

/// Critical urgency: Plasma and GNOME still show it under Do Not Disturb,
/// which owners often leave on during calls.
#[cfg(target_os = "linux")]
async fn notify_ended(app: &AppHandle, title: String, body: String) -> Result<(), String> {
    let name = app.package_info().name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        notify_rust::Notification::new()
            .appname(&name)
            .summary(&title)
            .body(&body)
            .urgency(notify_rust::Urgency::Critical)
            .show()
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "linux"))]
async fn notify_ended(app: &AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notifications_are_localized_without_exposing_keys() {
        assert_eq!(
            rust_i18n::t!("callDetection.title", locale = "en"),
            "Possible meeting detected"
        );
        assert_eq!(
            rust_i18n::t!("callDetection.title", locale = "pt-BR"),
            "Possível reunião detectada"
        );
        assert_eq!(
            rust_i18n::t!(
                "callDetection.body",
                locale = "pt-BR",
                app = "Microsoft Teams"
            ),
            "Possível chamada no Microsoft Teams. Abra o Coxinha para preparar a gravação."
        );
    }
    #[test]
    fn only_the_last_call_closing_during_a_capture_asks_to_stop() {
        let call = |pid| ActiveCall {
            app_name: "Google Chrome".into(),
            process_name: "chrome".into(),
            pid,
            is_browser: true,
            detected_at: chrono::Utc::now(),
        };
        let ended = [call(1)];
        assert!(asks_to_stop(&ended, &[], true, false));
        assert!(!asks_to_stop(&ended, &[], false, false));
        assert!(!asks_to_stop(&ended, &[], true, true));
        assert!(!asks_to_stop(&ended, &[call(2)], true, false));
        assert!(!asks_to_stop(&[], &[], true, false));
    }
    #[test]
    fn disabling_clears_calls_and_invalidates_an_inflight_poll() {
        let detector = Detector::default();
        detector.set_enabled(true);
        let generation = detector.generation.load(Ordering::SeqCst);
        detector.status().unavailable = true;
        detector.set_enabled(false);
        assert_ne!(generation, detector.generation.load(Ordering::SeqCst));
        assert!(!detector.status().enabled);
        assert!(!detector.status().unavailable);
        assert!(detector.status().calls.is_empty());
        let stable = detector.generation.load(Ordering::SeqCst);
        detector.set_enabled(false);
        assert_eq!(stable, detector.generation.load(Ordering::SeqCst));
    }
}
