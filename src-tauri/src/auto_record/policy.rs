//! Pure auto-record decisions (spec 0097 P1, ADR 0023). Fed by every
//! successful detector poll; never touches the library itself.
use serde::{Deserialize, Serialize};
use shared::ActiveCall;
use specta::Type;
use std::collections::BTreeSet;
use std::time::{Duration, Instant};

/// Spec 0087: grace after the detector's debounced absence (~12 s).
pub const STOP_GRACE: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    pub stop_when_call_ends: bool,
    pub mic_source: Option<String>,
    pub output_source: Option<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            stop_when_call_ends: true,
            mic_source: None,
            output_source: None,
        }
    }
}

/// What the library is doing right now, read from `library_status`.
#[derive(Clone, Debug, Default)]
pub struct Capture {
    pub active: Option<String>,
    /// Processing running or library unreachable: a start would be refused.
    pub busy: bool,
}

/// One call episode: same process and the instant the detector confirmed it.
pub type CallKey = (u32, String, String);
pub fn call_key(call: &ActiveCall) -> CallKey {
    (
        call.pid,
        call.process_name.clone(),
        call.detected_at.to_rfc3339(),
    )
}

#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
    pub call: ActiveCall,
    pub meeting: String,
    pub session: String,
    /// "Continuar gravando": the end of this call no longer stops it.
    pub keep: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Start(ActiveCall),
    Stop(String),
    /// Back-to-back: the bound call ended and another one began.
    StopThenStart(String, ActiveCall),
}

#[derive(Default)]
pub struct Policy {
    pub binding: Option<Binding>,
    pub stop_at: Option<Instant>,
    starting: Option<CallKey>,
    /// Calls already started, or observed while the user was recording.
    handled: BTreeSet<CallKey>,
}
impl Policy {
    /// A failed poll is unreliable evidence: never count it toward an ending.
    pub fn unreliable(&mut self) {
        self.stop_at = None;
    }

    pub fn observe(
        &mut self,
        now: Instant,
        settings: &Settings,
        calls: &[ActiveCall],
        capture: &Capture,
    ) -> Option<Command> {
        let keys: BTreeSet<CallKey> = calls.iter().map(call_key).collect();
        self.handled.retain(|k| keys.contains(k));
        if self.starting.is_some() {
            return None;
        }
        if self
            .binding
            .as_ref()
            .is_some_and(|b| capture.active.as_deref() != Some(b.meeting.as_str()))
        {
            // Stopped or switched by hand: nothing else stops automatically.
            self.binding = None;
            self.stop_at = None;
        }
        if !settings.enabled {
            self.binding = None;
            self.stop_at = None;
            self.handled.extend(keys);
            return None;
        }
        let bound = self.binding.as_ref().map(|b| call_key(&b.call));
        if capture.active.is_some() && bound.is_none() {
            // The user's own recording owns every call seen meanwhile.
            self.handled.extend(keys);
            return None;
        }
        let mut due = None;
        if let Some(b) = &self.binding {
            if keys.contains(&call_key(&b.call)) {
                self.stop_at = None;
            } else if settings.stop_when_call_ends && !b.keep {
                let at = *self.stop_at.get_or_insert(now + STOP_GRACE);
                if now >= at {
                    due = Some(b.meeting.clone());
                }
            }
        }
        let fresh = calls.iter().find(|c| {
            let k = call_key(c);
            Some(&k) != bound.as_ref() && !self.handled.contains(&k)
        });
        match (fresh, &self.binding) {
            (Some(call), None) if capture.active.is_none() && !capture.busy => {
                self.begin(call);
                Some(Command::Start(call.clone()))
            }
            (Some(call), Some(b)) if self.stop_at.is_some() => {
                let meeting = b.meeting.clone();
                self.begin(call);
                Some(Command::StopThenStart(meeting, call.clone()))
            }
            (Some(call), Some(_)) => {
                // A second call while the bound one is live stays a prompt.
                self.handled.insert(call_key(call));
                due.map(|m| self.stopped(m))
            }
            _ => due.map(|m| self.stopped(m)),
        }
    }

    fn begin(&mut self, call: &ActiveCall) {
        let key = call_key(call);
        self.handled.insert(key.clone());
        self.starting = Some(key);
        self.binding = None;
        self.stop_at = None;
    }
    fn stopped(&mut self, meeting: String) -> Command {
        self.binding = None;
        self.stop_at = None;
        Command::Stop(meeting)
    }
    pub fn started(&mut self, binding: Binding) {
        self.starting = None;
        self.stop_at = None;
        self.binding = Some(binding);
    }
    pub fn start_failed(&mut self) {
        self.starting = None;
    }
    pub fn keep(&mut self) {
        if let Some(b) = &mut self.binding {
            b.keep = true;
        }
        self.stop_at = None;
    }
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
