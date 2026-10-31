use super::*;
use coxinha_core::processing::ProcessingControl;
use std::{
    sync::mpsc::Receiver,
    thread::JoinHandle,
    time::{Duration, Instant},
};

pub(in crate::library) struct ProcessingTask {
    pub(in crate::library) meeting: String,
    pub(super) prepared: Option<PreparedProcessing>,
    pub(super) receive: Receiver<Result<Completion, String>>,
    pub(super) control: ProcessingControl,
    pub(super) thread: Option<JoinHandle<()>>,
}
#[cfg_attr(not(feature = "local-processing"), allow(dead_code))]
pub(super) enum Completion {
    Prepared(PreparedProcessing),
    Inferred(ProcessingResult),
}
impl ProcessingTask {
    pub(in crate::library) fn phase(&self) -> &'static str {
        if self.control.is_cancelled() {
            "stopping"
        } else if self.prepared.is_some() {
            "inference"
        } else {
            "validation"
        }
    }
    pub(in crate::library) fn status(&self) -> Value {
        json!({"meetingId":self.meeting,"job":self.prepared.as_ref().map(|p| &p.job),"phase":self.phase()})
    }
    pub(super) fn finished(&self) -> bool {
        self.thread
            .as_ref()
            .is_none_or(|thread| thread.is_finished())
    }
    pub(super) fn wait_for_exit(&mut self, grace: Duration) -> bool {
        let deadline = Instant::now() + grace;
        while !self.finished() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            std::thread::sleep(remaining.min(Duration::from_millis(2)));
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        true
    }
}
impl Drop for ProcessingTask {
    fn drop(&mut self) {
        self.control.cancel();
        // Every normal path drops only completed work. On actor/channel teardown
        // retain ownership until the read-only worker really exits, then free Store.
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
