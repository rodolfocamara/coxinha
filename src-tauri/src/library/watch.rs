//! Capture change detection. Meter peaks and elapsed time are polled, never signalled.
use super::*;

pub type Notifier = Box<dyn Fn() + Send + 'static>;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct CaptureSignature {
    active: Option<(String, bool)>,
    error: Option<String>,
    finalization_failed: Option<String>,
    processing: Option<(String, &'static str)>,
}
pub(super) struct CaptureWatch {
    last: CaptureSignature,
    notify: Option<Notifier>,
}
impl Worker {
    pub(super) fn capture_signature(&self) -> CaptureSignature {
        #[cfg(target_os = "linux")]
        let active = self.active.as_ref().map(|a| (a.id.clone(), a.paused));
        #[cfg(not(target_os = "linux"))]
        let active = None;
        CaptureSignature {
            active,
            error: self.error.clone(),
            finalization_failed: self.finalization_failed.clone(),
            processing: self
                .processing
                .as_ref()
                .map(|p| (p.meeting.clone(), p.phase())),
        }
    }
    /// `{"paused": bool}` while this meeting is the live capture, otherwise `null`.
    pub(super) fn live(&self, meeting: Option<&str>) -> Value {
        #[cfg(target_os = "linux")]
        let active = self.active.as_ref().map(|a| (a.id.as_str(), a.paused));
        #[cfg(not(target_os = "linux"))]
        let active = None;
        live_value(active, meeting)
    }
}
pub(super) fn live_value(active: Option<(&str, bool)>, meeting: Option<&str>) -> Value {
    match (active, meeting) {
        (Some((id, paused)), Some(meeting)) if id == meeting => json!({ "paused": paused }),
        _ => Value::Null,
    }
}
impl CaptureWatch {
    pub(super) fn new(worker: &Worker, notify: Option<Notifier>) -> Self {
        Self {
            last: worker.capture_signature(),
            notify,
        }
    }
    pub(super) fn observe(&mut self, worker: &Worker) {
        let next = worker.capture_signature();
        if next != self.last {
            self.last = next;
            if let Some(notify) = &self.notify {
                notify();
            }
        }
    }
}

/// Raw bytes are never deleted; a failed recovery leaves them for explicit "Recover".
pub(super) fn reconcile_orphans(store: &Store) {
    match store.reconcile_orphan_captures() {
        Ok(reports) => {
            for report in reports {
                match report.error {
                    None => {
                        tracing::info!(meeting = %report.meeting, "orphan capture recovered as interrupted")
                    }
                    Some(error) => {
                        tracing::warn!(meeting = %report.meeting, %error, "orphan capture marked interrupted; raw kept for explicit recovery")
                    }
                }
            }
        }
        Err(error) => {
            tracing::warn!(error = %format!("{error:#}"), "orphan capture reconciliation failed")
        }
    }
}

#[cfg(test)]
#[path = "watch_tests.rs"]
mod tests;
