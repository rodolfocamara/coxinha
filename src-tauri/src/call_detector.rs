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
                    continue;
                }
            }
        };
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
