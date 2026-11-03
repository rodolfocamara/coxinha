//! Voices remembered from confirmations (spec 0120). Pending confirmations
//! are enrolled once the library is idle, one meeting per pass; the raw
//! tracks are hashed on a helper thread so IPC never waits on audio IO.
use super::*;
use coxinha_core::identity::{verify_enrollment_source_at, VerifiedEnrollmentSource};
use std::collections::BTreeSet;
use std::sync::mpsc::TryRecvError;

const SCAN_EVERY: std::time::Duration = std::time::Duration::from_secs(10);

type Verification = (
    String,
    mpsc::Receiver<anyhow::Result<VerifiedEnrollmentSource>>,
);

#[derive(Default)]
pub(super) struct Voices {
    verify: Option<Verification>,
    last: Option<Instant>,
    /// Grows after each remembered batch; the UI reloads on it.
    pub(super) generation: u64,
    /// A new confirmation skips the wait.
    pub(super) kick: bool,
    /// Meetings whose batch hit a storage error in this session.
    skipped: BTreeSet<String>,
}

pub(super) enum VoiceAction {
    Reject {
        job: String,
        speaker: String,
        track: Option<String>,
        origin: String,
    },
    Retry(String),
    Forget(String, String),
    RememberAgain(String),
    Memory(String),
    Levels(String),
}

impl Worker {
    fn idle_for_voices(&self) -> bool {
        #[cfg(target_os = "linux")]
        let capturing = self.active.is_some();
        #[cfg(not(target_os = "linux"))]
        let capturing = false;
        !capturing && self.processing.is_none()
    }
    pub(super) fn pump_voices(&mut self) {
        if !self.idle_for_voices() {
            // A call or processing owns the disk; verify again afterwards.
            self.voices.verify = None;
            return;
        }
        if let Some((meeting, receiver)) = &self.voices.verify {
            let source = match receiver.try_recv() {
                Ok(source) => source,
                Err(TryRecvError::Empty) => return,
                Err(TryRecvError::Disconnected) => {
                    self.voices.verify = None;
                    return;
                }
            };
            let meeting = meeting.clone();
            self.voices.verify = None;
            match self.store.remember_voices(&meeting, source) {
                Ok(outcomes) => {
                    for o in &outcomes {
                        tracing::info!(
                            meeting,
                            assignment = o.assignment_id,
                            state = o.state,
                            samples = o.samples,
                            error = o.error.as_deref().unwrap_or(""),
                            "voice from confirmation"
                        );
                    }
                    self.voices.generation += 1;
                    self.voices.kick = true;
                }
                Err(error) => {
                    tracing::warn!(meeting, "voices from confirmations: {error:#}");
                    self.voices.skipped.insert(meeting);
                }
            }
            return;
        }
        if !self.voices.kick && self.voices.last.is_some_and(|t| t.elapsed() < SCAN_EVERY) {
            return;
        }
        self.voices.kick = false;
        self.voices.last = Some(Instant::now());
        let meeting = match self.store.next_voice_meeting(&self.voices.skipped) {
            Ok(Some(meeting)) => meeting,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!("pending voices: {error:#}");
                return;
            }
        };
        let root = self.store.root.clone();
        let (send, receive) = mpsc::channel();
        let id = meeting.clone();
        let spawned = std::thread::Builder::new()
            .name("voice-source".into())
            .spawn(move || {
                let _ = send.send(verify_enrollment_source_at(&root, &id));
            });
        if spawned.is_ok() {
            self.voices.verify = Some((meeting, receive));
        }
    }
    pub(super) fn voice_action(&mut self, action: VoiceAction) -> anyhow::Result<Value> {
        match action {
            VoiceAction::Reject {
                job,
                speaker,
                track,
                origin,
            } => {
                self.store.reject_processed_track_speaker(
                    &job,
                    &speaker,
                    track.as_deref(),
                    &origin,
                )?;
                Ok(Value::Null)
            }
            VoiceAction::Retry(assignment) => {
                self.store.retry_voice(&assignment)?;
                self.voices.kick = true;
                Ok(Value::Null)
            }
            VoiceAction::Forget(person, origin) => {
                let revoked = self.store.forget_voice(&person, &origin)?;
                self.voices.generation += 1;
                Ok(json!({ "revoked": revoked }))
            }
            VoiceAction::RememberAgain(person) => {
                self.store.remember_voice_again(&person)?;
                self.voices.kick = true;
                Ok(Value::Null)
            }
            VoiceAction::Memory(person) => self.store.voice_memory(&person),
            VoiceAction::Levels(job) => Ok(json!(self.store.speaker_levels(&job)?)),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn library_reject_speaker(
    state: State<'_, Library>,
    job: String,
    speaker: String,
    human_origin: String,
    track: Option<String>,
) -> Result<Value, String> {
    state
        .ask(Action::Voice(VoiceAction::Reject {
            job,
            speaker,
            track,
            origin: human_origin,
        }))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_retry_voice(
    state: State<'_, Library>,
    assignment_id: String,
) -> Result<Value, String> {
    state
        .ask(Action::Voice(VoiceAction::Retry(assignment_id)))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_forget_voice(
    state: State<'_, Library>,
    person_id: String,
    human_origin: String,
) -> Result<Value, String> {
    state
        .ask(Action::Voice(VoiceAction::Forget(person_id, human_origin)))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_remember_voice(
    state: State<'_, Library>,
    person_id: String,
) -> Result<Value, String> {
    state
        .ask(Action::Voice(VoiceAction::RememberAgain(person_id)))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_voice_memory(
    state: State<'_, Library>,
    person_id: String,
) -> Result<Value, String> {
    state
        .ask(Action::Voice(VoiceAction::Memory(person_id)))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_speaker_levels(
    state: State<'_, Library>,
    job: String,
) -> Result<Value, String> {
    state.ask(Action::Voice(VoiceAction::Levels(job))).await
}

#[cfg(test)]
#[path = "voices_tests.rs"]
mod tests;
