//! A single dedicated thread owns the library DB and capture subprocesses.
//! IPC never waits on a SQLite mutex and never performs audio IO on the runtime.
use coxinha_core::{capture::CaptureManifest, store::Store};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::mpsc, time::Instant};
use tauri::{Manager, State};

#[derive(Clone)]
pub struct Library {
    sender: mpsc::SyncSender<Request>,
    root: PathBuf,
    live: live::SharedLive,
}
struct Request {
    action: Action,
    reply: tokio::sync::oneshot::Sender<Result<Value, String>>,
}
enum Action {
    #[cfg(test)]
    ComparisonGate(curation_worker::TestGate),
    Session(sessions::SessionAction),
    Curation(curation::CurationAction),
    ImportAudio(String, String),
    Recognition(String),
    ParticipantContext(String),
    SetParticipantContext(String, Value),
    Process(String, Value),
    Processing(String, Option<String>),
    CreatePerson(String, String),
    ConfirmSpeaker {
        job: String,
        speaker: String,
        person: String,
        origin: String,
        enroll: bool,
        track: Option<String>,
    },
    RevokeAssignment(String, String),
    Edit(String, String, String),
    List,
    Detail(String),
    Recover(String),
    Start {
        session: Option<String>,
        title: String,
        mic: String,
        output: String,
    },
    Pause(bool),
    Stop,
    LiveConfigure(live::LiveSettings),
    LivePause(bool),
    LiveResume(String),
    Shutdown {
        allow_interrupted: bool,
    },
    Status,
}
#[cfg(target_os = "linux")]
struct Active {
    capture: coxinha_core::capture::PulseCapture,
    id: String,
    paused: bool,
    peaks: [f32; 2],
    last: [Option<Instant>; 2],
    checkpoint: Instant,
}
struct Worker {
    curation: curation_worker::CurationState,
    processing: Option<processing::ProcessingTask>,
    store: Store,
    #[cfg(target_os = "linux")]
    active: Option<Active>,
    error: Option<String>,
    finalization_failed: Option<String>,
    live: live::LiveSlot,
    root: PathBuf,
}
impl Library {
    pub fn open(root: PathBuf, notify: Option<Notifier>) -> anyhow::Result<Self> {
        let (sender, receiver) = mpsc::sync_channel::<Request>(16);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let live_slot = live::LiveSlot::default();
        let live = live_slot.shared.clone();
        let library_root = root.clone();
        let worker_root = root.clone();
        std::thread::Builder::new()
            .name("meeting-library".into())
            .spawn(move || {
                let store = match Store::open(root).and_then(|store| {
                    store.recover_jobs()?;
                    watch::reconcile_orphans(&store);
                    Ok(store)
                }) {
                    Ok(store) => {
                        let _ = ready_tx.send(Ok(()));
                        store
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("{e:#}")));
                        return;
                    }
                };
                let mut worker = Worker {
                    curation: Default::default(),
                    processing: None,
                    store,
                    #[cfg(target_os = "linux")]
                    active: None,
                    error: None,
                    finalization_failed: None,
                    live: live_slot,
                    root: worker_root,
                };
                let mut watch = watch::CaptureWatch::new(&worker, notify);
                loop {
                    #[cfg(target_os = "linux")]
                    let wait = if worker.active.is_some() { 0 } else { 100 };
                    #[cfg(not(target_os = "linux"))]
                    let wait = 100;
                    match receiver.recv_timeout(std::time::Duration::from_millis(wait)) {
                        Ok(request) => {
                            if let Some((reply, result)) = worker.dispatch(request) {
                                drop(worker);
                                let _ = reply.send(result);
                                return;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            worker.cancel_comparison();
                            let _ = worker.finish(true);
                            worker.live.shutdown();
                            let _ = worker.interrupt_processing();
                            // Join before dropping Store even when cooperative grace expired.
                            drop(worker.processing.take());
                            break;
                        }
                    }
                    worker.pump();
                    watch.observe(&worker);
                }
            })?;
        ready_rx
            .recv()
            .map_err(|e| anyhow::anyhow!(e))?
            .map_err(anyhow::Error::msg)?;
        Ok(Self {
            sender,
            root: library_root,
            live,
        })
    }
    pub async fn shutdown(&self) -> Result<(), String> {
        self.shutdown_mode(false).await.map(|_| ())
    }
    pub async fn shutdown_preserving_raw(&self) -> Result<Value, String> {
        self.shutdown_mode(true).await
    }
    async fn shutdown_mode(&self, allow_interrupted: bool) -> Result<Value, String> {
        let (reply, receive) = tokio::sync::oneshot::channel();
        let sender = self.sender.clone();
        // A saturated queue delays acknowledgement; it never masquerades as successful shutdown.
        tauri::async_runtime::spawn_blocking(move || {
            sender
                .send(Request {
                    action: Action::Shutdown { allow_interrupted },
                    reply,
                })
                .map_err(|_| "library worker unavailable")
        })
        .await
        .map_err(|_| "shutdown dispatch failed")?
        .map_err(|_| "library worker unavailable")?;
        receive
            .await
            .map_err(|_| "library worker stopped".to_string())?
    }
    async fn ask(&self, action: Action) -> Result<Value, String> {
        let (reply, receive) = tokio::sync::oneshot::channel();
        self.sender
            .try_send(Request { action, reply })
            .map_err(|e| format!("library busy or unavailable: {e}"))?;
        receive
            .await
            .map_err(|_| "library worker stopped".to_string())?
    }
}
impl Worker {
    fn status(&self) -> Value {
        #[cfg(target_os = "linux")]
        let active = self.active.as_ref().map(|a| {
            let meter = |i: usize| json!({"peak": if a.last[i].is_some_and(|t| t.elapsed().as_millis() < 300) { a.peaks[i] } else { 0.0 },
                "lastBlockMs": a.last[i].map(|t| t.elapsed().as_millis() as u64), "error": null});
            json!({"meetingId":a.id,"paused":a.paused,"elapsedMs":a.capture.elapsed_ns()/1_000_000,"mic":meter(0),"output":meter(1),"storage":recording_storage::snapshot(&self.store.root, &a.id, None)})
        });
        #[cfg(not(target_os = "linux"))]
        let active: Option<Value> = None;
        json!({"active":active,"error":self.error,"processing":self.processing.as_ref().map(|p|p.status())})
    }
    fn execute(&mut self, action: Action) -> anyhow::Result<Value> {
        match action {
            #[cfg(test)]
            Action::ComparisonGate(_) => unreachable!("test gate is handled by dispatch"),
            Action::Session(action) => self.session_action(action),
            Action::Curation(action) => self.curation_action(action),
            Action::ImportAudio(title, path) => {
                anyhow::ensure!(
                    self.processing.is_none(),
                    "finish processing before importing audio"
                );
                #[cfg(target_os = "linux")]
                anyhow::ensure!(
                    self.active.is_none(),
                    "finish capture before importing audio"
                );
                let id = self
                    .store
                    .import_audio(&title, std::path::Path::new(&path))?;
                self.detail(&id)
            }
            Action::Recognition(job) => self.store.recognition(&job),
            Action::ParticipantContext(meeting) => {
                Ok(json!(self.store.participant_context(&meeting)?))
            }
            Action::SetParticipantContext(meeting, participants) => {
                let participants: Vec<coxinha_core::recognition::ParticipantContext> =
                    serde_json::from_value(participants)?;
                self.store
                    .set_participant_context(&meeting, &participants)?;
                Ok(json!(self.store.participant_context(&meeting)?))
            }
            Action::Process(id, config) => self.start_processing(id, config),
            Action::Processing(id, job) => self.processing_detail(&id, job.as_deref()),
            Action::CreatePerson(name, origin) => {
                Ok(json!(self.store.create_person(&name, &[], &origin)?))
            }
            Action::ConfirmSpeaker {
                job,
                speaker,
                person,
                origin,
                enroll,
                track,
            } => {
                anyhow::ensure!(
                    self.processing.is_none(),
                    "finish local processing before voice enrollment"
                );
                #[cfg(target_os = "linux")]
                anyhow::ensure!(
                    self.active.is_none(),
                    "finish capture before voice enrollment"
                );
                let id = self.store.confirm_processed_track_speaker(
                    &job,
                    &speaker,
                    track.as_deref(),
                    &person,
                    &origin,
                )?;
                if enroll {
                    if let Err(error) = self.store.enroll_processed_speaker(&id, &job, &speaker) {
                        return Err(error.context("name confirmed; voice enrollment failed and no new samples remain active"));
                    }
                }
                Ok(Value::Null)
            }
            Action::RevokeAssignment(id, origin) => {
                self.store
                    .decide_assignment(&id, None, "revoked", &origin)?;
                Ok(Value::Null)
            }
            Action::Edit(meeting, target, body) => {
                self.store.edit(&meeting, &target, &body)?;
                Ok(Value::Null)
            }
            Action::List => Ok(json!(self.store.meeting_summaries()?)),
            Action::Status => Ok(self.status()),
            Action::Detail(id) => self.detail(&id),
            Action::Recover(id) => {
                anyhow::ensure!(
                    self.processing.is_none(),
                    "finish local processing before recovery"
                );
                #[cfg(target_os = "linux")]
                anyhow::ensure!(self.active.is_none(), "stop active capture before recovery");
                self.store.recover_capture(&id)?;
                if self.finalization_failed.as_deref() == Some(&id) {
                    self.finalization_failed = None;
                }
                self.detail(&id)
            }
            action @ (Action::LiveConfigure(_) | Action::LivePause(_) | Action::LiveResume(_)) => {
                self.live_action(action)
            }
            action @ (Action::Start { .. }
            | Action::Pause(_)
            | Action::Shutdown { .. }
            | Action::Stop) => self.capture_action(action),
        }
    }
    fn finish(&mut self, interrupted: bool) -> anyhow::Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(a) = self.active.take() {
            let result = a.capture.finish(&self.store, interrupted);
            // B1: every outcome is terminal for the live worker.
            let end = match &result {
                Ok(m) if m.state == "interrupted" => coxinha_core::live::EndState::Interrupted,
                Ok(_) => coxinha_core::live::EndState::Finished,
                Err(_) => coxinha_core::live::EndState::Failed,
            };
            self.live.ended(&a.id, end);
            match result {
                Ok(m) if m.state == "interrupted" => {
                    self.error = Some("capture interrupted; inspect recording details".into());
                    if !interrupted {
                        self.finalization_failed = Some(a.id);
                        anyhow::bail!("capture interrupted; recover recording before exiting");
                    }
                }
                Err(e) => {
                    self.finalization_failed = Some(a.id);
                    self.error =
                        Some("capture finalization failed; explicit recovery required".into());
                    return Err(e);
                }
                _ => {}
            }
        }
        #[cfg(not(target_os = "linux"))]
        let _ = interrupted;
        Ok(())
    }
    fn pump(&mut self) {
        self.pump_comparison();
        self.pump_processing();
        #[cfg(target_os = "linux")]
        if let Some(a) = self.active.as_mut() {
            let mut checkpointed = false;
            let result = (|| {
                if a.checkpoint.elapsed().as_secs() >= 1 {
                    a.capture.recording.request_checkpoint()?;
                    a.checkpoint = Instant::now();
                    checkpointed = true;
                }
                a.capture.pump()
            })();
            if checkpointed {
                self.live.committed(&a.id);
            }
            match result {
                Ok(Some((track, peak))) => {
                    let i = if matches!(track, coxinha_core::capture::Track::Mic) {
                        0
                    } else {
                        1
                    };
                    a.peaks[i] = peak;
                    a.last[i] = Some(Instant::now());
                }
                Ok(None) => {}
                Err(e) => {
                    self.error = Some(format!("{e:#}"));
                    let _ = self.finish(true);
                }
            }
        }
    }
}

mod curation;
mod curation_worker;
mod detail;
mod recording_storage;
pub use curation::*;
mod auto;
mod capture;
mod live;
pub use live::*;
mod commands;
mod note_deletion;
mod processing;
mod sessions;
mod watch;
pub use commands::*;
pub use sessions::*;
pub use watch::Notifier;

#[cfg(test)]
mod tests;
