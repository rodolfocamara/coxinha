//! Pure decisions for recordings that follow their call (spec 0097 P1,
//! spec 0118, ADR 0023). Fed by every successful detector poll; never
//! touches the library itself.
use serde::{Deserialize, Serialize};
use shared::ActiveCall;
use specta::Type;
use std::collections::BTreeSet;
use std::time::{Duration, Instant};

/// Spec 0118: no followed call and a quiet microphone for this long stops.
pub const QUIET_MINUTE: Duration = Duration::from_secs(60);

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
    /// Time since the microphone last carried speech, if it ever did.
    pub speech_ago: Option<Duration>,
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
/// Followed across reconnects: the same process, whatever the episode.
fn same_process(a: &ActiveCall, b: &ActiveCall) -> bool {
    a.pid == b.pid && a.process_name == b.process_name
}

#[derive(Clone, Debug, PartialEq)]
pub struct Follow {
    pub meeting: String,
    /// Set when automatic recording started this capture.
    pub session: Option<String>,
    pub calls: Vec<ActiveCall>,
    /// "Continuar gravando": the end of these calls no longer stops it.
    pub keep: bool,
    gone: Option<Instant>,
}
impl Follow {
    pub fn new(meeting: String, session: Option<String>, calls: &[ActiveCall]) -> Self {
        let mut follow = Self {
            meeting,
            session,
            calls: vec![],
            keep: false,
            gone: None,
        };
        follow.adopt(calls);
        follow
    }
    pub fn follows(&self, call: &ActiveCall) -> bool {
        self.calls.iter().any(|c| same_process(c, call))
    }
    fn adopt(&mut self, calls: &[ActiveCall]) {
        for call in calls {
            if !self.follows(call) {
                self.calls.push(call.clone());
            }
        }
    }
    pub fn app(&self) -> String {
        self.calls
            .first()
            .map(|c| c.app_name.clone())
            .unwrap_or_default()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Start(ActiveCall),
    Stop {
        meeting: String,
        app: String,
    },
    /// Back-to-back: the followed call ended and another one began.
    StopThenStart {
        meeting: String,
        app: String,
        call: ActiveCall,
    },
}

#[derive(Default)]
pub struct Policy {
    pub follow: Option<Follow>,
    pub stop_at: Option<Instant>,
    starting: Option<CallKey>,
    /// Asked to stop: this meeting is never followed again.
    stopping: Option<String>,
    /// Calls already started, or observed while automatic recording could not.
    handled: BTreeSet<CallKey>,
}
impl Policy {
    /// A failed poll is unreliable evidence: never count it toward an ending.
    pub fn unreliable(&mut self) {
        self.stop_at = None;
        if let Some(f) = &mut self.follow {
            f.gone = None;
        }
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
        if self.stopping.is_some() && self.stopping != capture.active {
            self.stopping = None;
        }
        match &capture.active {
            None => self.follow = None,
            Some(m) if self.follow.as_ref().is_some_and(|f| &f.meeting == m) => {}
            Some(m) if self.stopping.as_ref() == Some(m) => self.follow = None,
            Some(m) => self.follow = Some(Follow::new(m.clone(), None, calls)),
        }
        if self.follow.is_none() {
            self.stop_at = None;
        }
        let automatic = self.follow.as_ref().is_some_and(|f| f.session.is_some());
        if !settings.enabled || (capture.active.is_some() && !automatic) {
            // The user's own recording owns every call seen meanwhile.
            self.handled.extend(keys.iter().cloned());
        }
        let fresh = calls.iter().find(|c| !self.handled.contains(&call_key(c)));
        let Some(follow) = self.follow.as_mut() else {
            return match fresh {
                Some(call) if settings.enabled && capture.active.is_none() => {
                    let call = call.clone();
                    self.begin(&call);
                    Some(Command::Start(call))
                }
                _ => None,
            };
        };
        let live = calls.iter().any(|c| follow.follows(c));
        if live {
            // A second call while a followed one is on stays a prompt.
            self.handled.extend(keys);
        }
        let stops = settings.stop_when_call_ends && !follow.keep;
        if !live && !follow.calls.is_empty() && stops && automatic {
            if let Some(call) = fresh.cloned() {
                let (meeting, app) = (follow.meeting.clone(), follow.app());
                self.begin(&call);
                return Some(Command::StopThenStart { meeting, app, call });
            }
        }
        if !live {
            // Never stop in the middle of a call: one that is on now is followed.
            follow.adopt(calls);
        }
        for call in calls.iter().filter(|c| follow.follows(c)) {
            self.handled.insert(call_key(call));
        }
        if calls.iter().any(|c| follow.follows(c)) || follow.calls.is_empty() {
            follow.gone = None;
            self.stop_at = None;
            return None;
        }
        let gone = *follow.gone.get_or_insert(now);
        if !stops {
            self.stop_at = None;
            return None;
        }
        let speech = capture.speech_ago.and_then(|ago| now.checked_sub(ago));
        let at = speech.map_or(gone, |s| s.max(gone)) + QUIET_MINUTE;
        self.stop_at = Some(at);
        if now < at {
            return None;
        }
        let (meeting, app) = (follow.meeting.clone(), follow.app());
        self.follow = None;
        self.stop_at = None;
        self.stopping = Some(meeting.clone());
        Some(Command::Stop { meeting, app })
    }

    /// Whether the end of these calls will stop the live capture by itself.
    pub fn stops_on_end(&self, settings: &Settings, ended: &[ActiveCall]) -> bool {
        settings.stop_when_call_ends
            && self
                .follow
                .as_ref()
                .is_some_and(|f| !f.keep && ended.iter().any(|c| f.follows(c)))
    }

    fn begin(&mut self, call: &ActiveCall) {
        let key = call_key(call);
        self.handled.insert(key.clone());
        self.starting = Some(key);
        self.follow = None;
        self.stop_at = None;
    }
    pub fn started(&mut self, meeting: String, session: String, call: &ActiveCall) {
        self.starting = None;
        self.stop_at = None;
        self.follow = Some(Follow::new(
            meeting,
            Some(session),
            std::slice::from_ref(call),
        ));
    }
    pub fn start_failed(&mut self) {
        self.starting = None;
    }
    pub fn keep(&mut self) {
        if let Some(f) = &mut self.follow {
            f.keep = true;
        }
        self.stop_at = None;
    }
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
