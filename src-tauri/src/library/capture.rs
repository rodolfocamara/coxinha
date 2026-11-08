use super::*;

/// Spec 0118: a 1 s microphone peak above this is the owner speaking.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const SPEECH_PEAK: f32 = 0.08;

#[cfg(target_os = "linux")]
pub(super) struct Active {
    pub(super) capture: coxinha_core::capture::PulseCapture,
    pub(super) id: String,
    pub(super) paused: bool,
    meters: Meters,
    checkpoint: Instant,
}
#[cfg(target_os = "linux")]
impl Active {
    pub(super) fn status(&self, root: &std::path::Path) -> Value {
        let now = Instant::now();
        let mut mic = self.meters.json(0, now);
        mic["speechAgoMs"] = json!(self.meters.speech.map(|t| millis(now, t)));
        json!({"meetingId":self.id,"paused":self.paused,"elapsedMs":self.capture.elapsed_ns()/1_000_000,"mic":mic,"output":self.meters.json(1, now),"storage":recording_storage::snapshot(root, &self.id, None)})
    }
}

/// Latest block peak per track (mic, output) and the last microphone speech.
#[derive(Default)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
struct Meters {
    peaks: [f32; 2],
    last: [Option<Instant>; 2],
    speech: Option<Instant>,
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
impl Meters {
    fn record(&mut self, track: usize, peak: f32, now: Instant) {
        self.peaks[track] = peak;
        self.last[track] = Some(now);
        if track == 0 && peak > SPEECH_PEAK {
            self.speech = Some(now);
        }
    }
    fn json(&self, track: usize, now: Instant) -> Value {
        let fresh = self.last[track].is_some_and(|t| millis(now, t) < 300);
        json!({"peak": if fresh { self.peaks[track] } else { 0.0 },
            "lastBlockMs": self.last[track].map(|t| millis(now, t)), "error": null})
    }
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn millis(now: Instant, then: Instant) -> u64 {
    now.saturating_duration_since(then).as_millis() as u64
}

impl Worker {
    #[cfg(target_os = "linux")]
    pub(super) fn pump_capture(&mut self) {
        let Some(a) = self.active.as_mut() else {
            return;
        };
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
                let mic = matches!(track, coxinha_core::capture::Track::Mic);
                a.meters
                    .record(if mic { 0 } else { 1 }, peak, Instant::now());
            }
            Ok(None) => {}
            Err(e) => {
                self.error = Some(format!("{e:#}"));
                let _ = self.finish(true);
            }
        }
    }
    pub(super) fn capture_action(&mut self, action: Action) -> anyhow::Result<Value> {
        match action {
            Action::Start {
                session,
                title,
                mic,
                output,
            } => {
                #[cfg(target_os = "linux")]
                {
                    anyhow::ensure!(self.active.is_none(), "capture already active");
                    anyhow::ensure!(title.trim().len() <= 500, "title exceeds 500 bytes");
                    // Validate devices before creating a durable meeting.
                    let sources = coxinha_core::capture::list_sources()?;
                    anyhow::ensure!(
                        sources.iter().any(|s| s.name == mic && !s.monitor)
                            && sources.iter().any(|s| s.name == output && s.monitor),
                        "select an explicit input and distinct output monitor"
                    );
                    self.yield_processing();
                    let id = match session {
                        Some(session) => self
                            .store
                            .create_meeting_for_session(&session, title.trim())?,
                        None => self.store.create_meeting(title.trim())?,
                    };
                    let capture = match coxinha_core::capture::PulseCapture::start(
                        &self.store,
                        &id,
                        &mic,
                        &output,
                    ) {
                        Ok(c) => c,
                        Err(e) => {
                            self.error = Some(format!("{e:#}"));
                            return Err(e);
                        }
                    };
                    self.error = None;
                    self.live.capture_started(&self.root, &id);
                    self.active = Some(Active {
                        capture,
                        id,
                        paused: false,
                        meters: Meters::default(),
                        checkpoint: Instant::now(),
                    });
                    Ok(self.status())
                }
                #[cfg(not(target_os = "linux"))]
                {
                    let _ = (session, title, mic, output);
                    anyhow::bail!("capture adapter unavailable on this platform")
                }
            }
            Action::Pause(paused) => {
                #[cfg(target_os = "linux")]
                {
                    let a = self
                        .active
                        .as_mut()
                        .ok_or_else(|| anyhow::anyhow!("no active capture"))?;
                    if a.paused != paused {
                        a.capture.pause(paused)?;
                        a.paused = paused;
                    }
                    Ok(self.status())
                }
                #[cfg(not(target_os = "linux"))]
                {
                    let _ = paused;
                    anyhow::bail!("capture adapter unavailable")
                }
            }
            Action::Shutdown { allow_interrupted } => {
                if allow_interrupted {
                    #[cfg(target_os = "linux")]
                    let had_capture = self.active.is_some();
                    #[cfg(not(target_os = "linux"))]
                    let had_capture = false;
                    let capture_failed = self.finish(true).is_err()
                        || self.finalization_failed.is_some()
                        || had_capture;
                    // Do not acknowledge library shutdown while an inference thread
                    // remains alive. ADR 0020 may still explicitly exit the process.
                    self.interrupt_processing()?;
                    self.live.shutdown();
                    let processing_failed = false;
                    return Ok(
                        json!({"captureRecoveryRequired":capture_failed,"processingRecoveryRequired":processing_failed}),
                    );
                }
                anyhow::ensure!(
                    self.finalization_failed.is_none(),
                    "capture finalization failed; recover recording before exit"
                );
                self.finish(false)?;
                self.interrupt_processing()?;
                self.live.shutdown();
                Ok(self.status())
            }
            Action::Stop => {
                self.finish(false)?;
                Ok(self.status())
            }
            _ => unreachable!("non-capture action dispatched to capture worker"),
        }
    }
}

impl Worker {
    pub(super) fn finish(&mut self, interrupted: bool) -> anyhow::Result<()> {
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
            if result.is_ok() {
                // Spec 0115 P4: an unscheduled recording shows its real span.
                let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
                if let Err(error) = self.store.date_unscheduled(&a.id, &now) {
                    tracing::warn!("recording kept no agenda time: {error:#}");
                }
            }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_a_microphone_peak_above_the_floor_counts_as_speech() {
        let t = Instant::now();
        let mut meters = Meters::default();
        meters.record(0, 0.03, t);
        meters.record(1, 0.9, t);
        assert_eq!(meters.speech, None);
        meters.record(0, 0.08, t);
        assert_eq!(meters.speech, None);
        let spoke = t + std::time::Duration::from_secs(2);
        meters.record(0, 0.2, spoke);
        meters.record(0, 0.01, spoke + std::time::Duration::from_secs(5));
        assert_eq!(meters.speech, Some(spoke));
        let json = meters.json(0, spoke + std::time::Duration::from_secs(6));
        assert_eq!(json["peak"], 0.0);
        assert_eq!(json["lastBlockMs"], 1000);
    }
}
