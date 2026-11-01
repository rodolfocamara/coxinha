use super::*;
impl Worker {
    pub(super) fn capture_action(&mut self, action: Action) -> anyhow::Result<Value> {
        match action {
            Action::Start {
                session,
                title,
                mic,
                output,
            } => {
                anyhow::ensure!(
                    self.processing.is_none(),
                    "finish local processing before capture"
                );
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
                    self.live.started(&self.root, &id);
                    self.active = Some(Active {
                        capture,
                        id,
                        paused: false,
                        peaks: [0.0; 2],
                        last: [None, None],
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
