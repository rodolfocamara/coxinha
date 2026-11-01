use super::*;
#[cfg(any(feature = "local-processing", test))]
use coxinha_core::processing::ProcessingControl;
use coxinha_core::processing::{PreparedProcessing, ProcessingResult};
use std::sync::mpsc::TryRecvError;
mod task;
use task::Completion;
pub(super) use task::ProcessingTask;

impl Worker {
    /// Only this actor can publish. Cancellation never releases the owner before join.
    pub(super) fn interrupt_processing(&mut self) -> anyhow::Result<()> {
        if let Some(task) = self.processing.as_mut() {
            task.control.cancel();
            anyhow::ensure!(
                task.wait_for_exit(std::time::Duration::from_millis(250)),
                "local processing is stopping; retry closing after it finishes"
            );
            if let Some(prepared) = task.prepared.as_ref() {
                self.store.finish_job(
                    &prepared.job,
                    Some("interrupted by explicit desktop exit; retry processing"),
                )?;
            }
        }
        self.processing = None;
        Ok(())
    }
    pub(super) fn start_processing(
        &mut self,
        meeting: String,
        config: Value,
    ) -> anyhow::Result<Value> {
        anyhow::ensure!(self.processing.is_none(), "local processing already active");
        // B3: one ASR model resident; the live drain finishes first.
        anyhow::ensure!(
            !self.live.busy(),
            "live transcript still running; try again when it finishes"
        );
        #[cfg(target_os = "linux")]
        anyhow::ensure!(self.active.is_none(), "finish capture before processing");
        #[cfg(not(feature = "local-processing"))]
        {
            let _ = (meeting, config);
            anyhow::bail!("local processing engines unavailable; build the desktop app with --features local-processing and select local model files");
        }
        #[cfg(feature = "local-processing")]
        {
            let config: coxinha_core::processing::ProcessingConfig =
                serde_json::from_value(config)?;
            let root = self.store.root.clone();
            let id = meeting.clone();
            let (send, receive) = mpsc::channel();
            let control = ProcessingControl::default();
            let cancellation = control.clone();
            let thread = std::thread::Builder::new()
                .name("meeting-validation".into())
                .spawn(move || {
                    let result = std::panic::catch_unwind(|| {
                        cancellation.check()?;
                        let result =
                            coxinha_core::processing::preflight_processing(root, id, config);
                        cancellation.check()?;
                        result
                    })
                    .map_err(|_| "model validation worker panicked".to_string())
                    .and_then(|r| r.map(Completion::Prepared).map_err(|e| format!("{e:#}")));
                    let _ = send.send(result);
                })?;
            self.processing = Some(ProcessingTask {
                meeting,
                prepared: None,
                receive,
                control,
                thread: Some(thread),
            });
            self.error = None;
            Ok(self.status())
        }
    }
    pub(super) fn pump_processing(&mut self) {
        let Some(task) = self.processing.as_ref() else {
            return;
        };
        if !task.finished() {
            return;
        }
        let completion = match task.receive.try_recv() {
            Ok(value) => value,
            Err(TryRecvError::Empty) => return,
            Err(TryRecvError::Disconnected) => {
                Err("local processing worker stopped unexpectedly".into())
            }
        };
        let task = self.processing.take().unwrap();
        let completion = if task.control.is_cancelled() {
            Err("interrupted by explicit desktop exit; retry processing".into())
        } else {
            completion
        };
        let result: anyhow::Result<()> = (|| {
            match completion.map_err(anyhow::Error::msg)? {
                Completion::Prepared(input) => {
                    let prepared = self.store.prepare_verified_processing(input)?;
                    let state = self.store.job_state(&prepared.job)?;
                    if state == "succeeded" {
                        self.store.resume_processing_publication(&prepared)?;
                        return Ok(());
                    }
                    if state == "failed" {
                        self.store.retry_job(&prepared.job)?;
                    }
                    anyhow::ensure!(
                        self.store.claim(&prepared.job)?,
                        "processing job could not be claimed"
                    );
                    match self.store.resume_processing_publication(&prepared) {
                        Ok(true) => return Ok(()),
                        Ok(false) => {}
                        Err(error) => {
                            if self.store.job_state(&prepared.job)? == "running" {
                                self.store
                                    .finish_job(&prepared.job, Some(&format!("{error:#}")))?;
                            }
                            return Err(error);
                        }
                    }
                    if let Err(error) = self.spawn_inference(prepared.clone()) {
                        self.store
                            .finish_job(&prepared.job, Some(&format!("{error:#}")))?;
                        return Err(error);
                    }
                }
                Completion::Inferred(result) => {
                    let prepared = task
                        .prepared
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("missing processing input"))?;
                    self.store.commit_processing(prepared, result)?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            if let Some(input) = task.prepared.as_ref() {
                let _ = self
                    .store
                    .finish_job(&input.job, Some(&format!("{error:#}")));
            }
            self.error = Some(format!("{error:#}"));
        }
    }
    fn spawn_inference(&mut self, prepared: PreparedProcessing) -> anyhow::Result<()> {
        #[cfg(feature = "local-processing")]
        {
            let input = prepared.clone();
            let (send, receive) = mpsc::channel();
            let control = ProcessingControl::default();
            let cancellation = control.clone();
            let thread = std::thread::Builder::new()
                .name("meeting-inference".into())
                .spawn(move || {
                    let result = std::panic::catch_unwind(|| {
                        coxinha_core::processing::run_processing_controlled(
                            input,
                            coxinha_core::speech::LocalSpeechEngine,
                            &cancellation,
                        )
                    })
                    .map_err(|_| "local inference worker panicked".to_string())
                    .and_then(|r| r.map(Completion::Inferred).map_err(|e| format!("{e:#}")));
                    let _ = send.send(result);
                })?;
            self.processing = Some(ProcessingTask {
                meeting: prepared.meeting.clone(),
                prepared: Some(prepared),
                receive,
                control,
                thread: Some(thread),
            });
            Ok(())
        }
        #[cfg(not(feature = "local-processing"))]
        {
            let _ = prepared;
            anyhow::bail!("local processing engines unavailable")
        }
    }
    pub(super) fn processing_detail(
        &self,
        meeting: &str,
        job: Option<&str>,
    ) -> anyhow::Result<Value> {
        let jobs = self.store.meeting_processing_jobs(meeting)?;
        let loaded = if let Some(job) = job {
            anyhow::ensure!(
                jobs.iter().any(|item| item["id"] == job),
                "processing job does not belong to meeting"
            );
            self.store.processing_report_by_job(job)
        } else {
            self.store.processing_report(meeting)
        };
        let report = match loaded {
            Ok(report) => Some(report),
            Err(error)
                if error
                    .downcast_ref::<rusqlite::Error>()
                    .is_some_and(|e| matches!(e, rusqlite::Error::QueryReturnedNoRows)) =>
            {
                None
            }
            Err(error) => return Err(error),
        };
        Ok(json!({"jobs":jobs,"report":report,"people":self.store.list_people()?}))
    }
}

#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod tests;

#[cfg(all(test, feature = "local-processing"))]
mod publication_tests;
