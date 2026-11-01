//! The live-transcript slot: one thread, one model, a FIFO of meetings.
use super::{run, Asr, AsrFactory, EndState, LiveSnapshot};
use std::{
    collections::{HashMap, VecDeque},
    panic::AssertUnwindSafe,
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, MutexGuard},
    thread::JoinHandle,
    time::{Duration, Instant},
};

#[derive(Clone, Copy)]
pub(crate) struct Tuning {
    /// Unload the model after this long without an active meeting.
    pub idle_unload: Duration,
    /// Re-read the checkpoint after this long without a message.
    pub recheck: Duration,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            idle_unload: Duration::from_secs(120),
            recheck: Duration::from_secs(5),
        }
    }
}

#[derive(Default)]
pub(crate) struct Shared {
    pub queue: VecDeque<String>,
    pub active: Option<String>,
    pub ended: HashMap<String, EndState>,
    /// Set by any message; the worker clears it before reading a checkpoint.
    pub wake: bool,
    pub paused: bool,
    pub cancelled: bool,
    /// The active meeting is being deleted: stop without appending.
    pub abandon: bool,
    pub meeting: Option<String>,
    pub state: &'static str,
    pub error: Option<String>,
    pub behind_ms: u64,
}

pub(crate) struct Inner {
    pub root: PathBuf,
    pub tuning: Tuning,
    shared: Mutex<Shared>,
    signal: Condvar,
}

impl Inner {
    /// A poisoned lock still holds consistent plain data; never panic a caller.
    pub fn lock(&self) -> MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Waits for a message or `timeout`; returns the guard to re-check state.
    pub fn wait<'a>(
        &self,
        guard: MutexGuard<'a, Shared>,
        timeout: Duration,
    ) -> MutexGuard<'a, Shared> {
        self.signal
            .wait_timeout_while(guard, timeout, |s| !s.wake && !s.cancelled)
            .unwrap_or_else(|e| e.into_inner())
            .0
    }

    fn notify(&self, mut shared: MutexGuard<'_, Shared>) {
        shared.wake = true;
        drop(shared);
        self.signal.notify_all();
    }
}

impl Shared {
    fn holds(&self, meeting: &str) -> bool {
        self.active.as_deref() == Some(meeting) || self.queue.iter().any(|m| m == meeting)
    }
}

pub struct LiveTranscriber {
    inner: Arc<Inner>,
    thread: Option<JoinHandle<()>>,
}

impl LiveTranscriber {
    /// Returns immediately. The model is loaded on the worker thread when the
    /// first meeting starts and unloaded after two idle minutes.
    pub fn spawn(root: PathBuf, factory: Arc<dyn AsrFactory>) -> Self {
        Self::spawn_tuned(root, factory, Tuning::default())
    }

    pub(crate) fn spawn_tuned(root: PathBuf, factory: Arc<dyn AsrFactory>, tuning: Tuning) -> Self {
        let inner = Arc::new(Inner {
            root,
            tuning,
            shared: Mutex::new(Shared {
                state: "idle",
                ..Shared::default()
            }),
            signal: Condvar::new(),
        });
        let worker = inner.clone();
        let thread = std::thread::Builder::new()
            .name("live-transcript".into())
            .spawn(move || main_loop(&worker, factory.as_ref()));
        let thread = match thread {
            Ok(handle) => Some(handle),
            Err(e) => {
                let mut s = inner.lock();
                s.state = "failed";
                s.error = Some(format!("live transcript thread: {e}"));
                s.cancelled = true;
                None
            }
        };
        Self { inner, thread }
    }

    /// FIFO; a meeting already queued or active is ignored.
    pub fn enqueue(&self, meeting: &str) {
        let mut s = self.inner.lock();
        if s.cancelled || s.holds(meeting) {
            return;
        }
        s.queue.push_back(meeting.to_owned());
        self.inner.notify(s);
    }

    /// A checkpoint advanced; wakes the worker.
    pub fn committed(&self, meeting: &str) {
        let s = self.inner.lock();
        if s.holds(meeting) {
            self.inner.notify(s);
        }
    }

    /// Terminal for every state: the worker drains to the last committed frame
    /// and closes the meeting. A meeting neither queued nor active is ignored;
    /// "Transcrever o resto" is `enqueue` followed by `end`.
    pub fn end(&self, meeting: &str, state: EndState) {
        let mut s = self.inner.lock();
        if s.holds(meeting) {
            s.ended.insert(meeting.to_owned(), state);
            self.inner.notify(s);
        }
    }

    /// Dequeues a meeting, or stops it after the window in flight, before the
    /// meeting is deleted. Nothing more is appended to its transcript.
    pub fn forget(&self, meeting: &str) {
        let mut s = self.inner.lock();
        s.queue.retain(|m| m != meeting);
        if s.active.as_deref() == Some(meeting) {
            s.abandon = true;
        } else {
            s.ended.remove(meeting);
        }
        self.inner.notify(s);
    }

    /// Stops dispatching windows; capture is unaffected.
    pub fn pause(&self, paused: bool) {
        let mut s = self.inner.lock();
        s.paused = paused;
        self.inner.notify(s);
    }

    /// Requests a stop and never joins: a window in flight runs to completion.
    pub fn cancel(&self) {
        let mut s = self.inner.lock();
        s.cancelled = true;
        self.inner.notify(s);
    }

    pub fn is_busy(&self) -> bool {
        let s = self.inner.lock();
        s.active.is_some() || !s.queue.is_empty()
    }

    /// Whether the worker thread has exited, after `cancel`.
    pub fn is_finished(&self) -> bool {
        self.thread.as_ref().is_none_or(|t| t.is_finished())
    }

    pub fn snapshot(&self) -> LiveSnapshot {
        let s = self.inner.lock();
        LiveSnapshot {
            meeting: s.meeting.clone(),
            state: s.state.to_owned(),
            error: s.error.clone(),
            behind_ms: s.behind_ms,
            queued: s.queue.iter().cloned().collect(),
        }
    }
}

impl Drop for LiveTranscriber {
    fn drop(&mut self) {
        self.cancel();
    }
}

fn main_loop(inner: &Inner, factory: &dyn AsrFactory) {
    let mut model: Option<Box<dyn Asr>> = None;
    let mut idle_since = Instant::now();
    loop {
        let meeting = {
            let mut s = inner.lock();
            loop {
                if s.cancelled {
                    s.queue.clear();
                    s.ended.clear();
                    s.active = None;
                    return;
                }
                if let Some(meeting) = s.queue.pop_front() {
                    s.active = Some(meeting.clone());
                    s.meeting = Some(meeting.clone());
                    s.error = None;
                    s.behind_ms = 0;
                    s.state = if model.is_some() {
                        "running"
                    } else {
                        "loading"
                    };
                    break meeting;
                }
                let idle = idle_since.elapsed();
                if model.is_some() && idle >= inner.tuning.idle_unload {
                    model = None;
                }
                s.wake = false;
                let timeout = match model {
                    Some(_) => inner.tuning.idle_unload - idle,
                    None => Duration::from_secs(3600),
                };
                s = inner.wait(s, timeout);
            }
        };
        let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
            let asr = match &mut model {
                Some(asr) => asr,
                None => model.insert(factory.load()?),
            };
            run::drain(inner, &meeting, asr.as_mut())
        }));
        let failure = match result {
            Ok(Ok(())) => None,
            Ok(Err(e)) => Some(format!("{e:#}")),
            Err(_) => {
                model = None;
                Some("speech engine panicked".to_owned())
            }
        };
        let mut s = inner.lock();
        s.ended.remove(&meeting);
        s.active = None;
        s.abandon = false;
        s.behind_ms = 0;
        match failure {
            Some(error) => {
                s.state = "failed";
                s.error = Some(error);
            }
            None => {
                s.state = "idle";
                s.meeting = None;
            }
        }
        idle_since = Instant::now();
    }
}
