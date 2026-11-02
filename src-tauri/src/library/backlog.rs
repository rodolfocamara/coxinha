//! Automatic transcription of recordings without a complete transcript
//! (spec 0098). Runs only while idle, one meeting at a time through the live
//! slot, so at most one ASR model is resident. A call preempts it. Once every
//! transcript is complete, the same loop separates speakers (spec 0099).
use super::live::transcript_complete;
use super::*;
use std::collections::BTreeSet;
use std::sync::mpsc::TryRecvError;

const SCAN_EVERY: std::time::Duration = std::time::Duration::from_secs(20);

struct Scan {
    /// The previous meeting is still incomplete after its run: it failed.
    failed: Option<String>,
    next: Option<String>,
    /// Speaker separation over a complete live transcript, with its config.
    diarize: Option<(String, Value)>,
}

#[derive(Default)]
pub(super) struct Backlog {
    scan: Option<mpsc::Receiver<Scan>>,
    last: Option<Instant>,
    pub(super) current: Option<String>,
    /// Failed once, or already handed to processing, in this session.
    skipped: BTreeSet<String>,
}
impl Backlog {
    /// A call or processing owns the engine: drop any pending choice.
    pub(super) fn reset(&mut self) {
        self.scan = None;
        self.current = None;
    }
}

/// Newest first; never the meeting that just failed or one skipped before.
pub(super) fn choose(
    candidates: &[String],
    skipped: &BTreeSet<String>,
    eligible: impl Fn(&str) -> bool,
    complete: impl Fn(&str) -> bool,
) -> Option<String> {
    candidates
        .iter()
        .find(|m| !skipped.contains(*m) && eligible(m) && !complete(m))
        .cloned()
}

fn eligible(root: &std::path::Path, meeting: &str) -> bool {
    use coxinha_core::capture::{CommittedTrack, Track};
    // Imported or broken recordings have no committed checkpoint to resume.
    [Track::Mic, Track::Output]
        .iter()
        .all(|t| CommittedTrack::open(root, meeting, *t).is_ok_and(|c| c.frames() > 0))
}

impl Worker {
    pub(super) fn pump_backlog(&mut self) {
        #[cfg(target_os = "linux")]
        let capturing = self.active.is_some();
        #[cfg(not(target_os = "linux"))]
        let capturing = false;
        if capturing || self.processing.is_some() || !self.live.backlog_on() {
            self.live.backlog.scan = None;
            return;
        }
        if self.live.busy() {
            return;
        }
        if let Some(receiver) = &self.live.backlog.scan {
            let scan = match receiver.try_recv() {
                Ok(scan) => scan,
                Err(TryRecvError::Empty) => return,
                Err(TryRecvError::Disconnected) => {
                    self.live.backlog.scan = None;
                    return;
                }
            };
            self.live.backlog.scan = None;
            if let Some(failed) = scan.failed {
                tracing::info!(meeting = failed, "automatic transcription failed; skipped");
                self.live.backlog.skipped.insert(failed);
            }
            if let Some(meeting) = scan.next {
                tracing::info!(meeting, "automatic transcription queued");
                self.live.backlog.current = Some(meeting.clone());
                self.live.resume(&self.root, &meeting);
            } else if let Some((meeting, config)) = scan.diarize {
                tracing::info!(meeting, "automatic speaker separation queued");
                self.live.backlog.skipped.insert(meeting.clone());
                if let Err(error) = self.start_processing(meeting.clone(), config) {
                    tracing::warn!(meeting, "automatic speaker separation: {error:#}");
                }
            }
            return;
        }
        if self
            .live
            .backlog
            .last
            .is_some_and(|t| t.elapsed() < SCAN_EVERY)
        {
            return;
        }
        self.live.backlog.last = Some(Instant::now());
        let Ok(meetings) = self.store.meeting_summaries() else {
            return;
        };
        let candidates: Vec<String> = meetings
            .iter()
            .filter(|m| matches!(m["captureState"].as_str(), Some("finished" | "interrupted")))
            .filter_map(|m| m["id"].as_str().map(str::to_owned))
            .collect();
        // Any local-processing job, even a failed one, means "leave it to the user".
        let undiarized: Vec<String> = candidates
            .iter()
            .filter(|m| {
                self.store
                    .meeting_processing_jobs(m)
                    .is_ok_and(|jobs| jobs.is_empty())
            })
            .cloned()
            .collect();
        let previous = self.live.backlog.current.take();
        let mut skipped = self.live.backlog.skipped.clone();
        let root = self.root.clone();
        let (send, receive) = mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("transcript-backlog".into())
            .spawn(move || {
                let failed = previous.filter(|m| !transcript_complete(&root, m));
                skipped.extend(failed.clone());
                let next = choose(
                    &candidates,
                    &skipped,
                    |m| eligible(&root, m),
                    |m| transcript_complete(&root, m),
                );
                let diarize = if next.is_none() {
                    undiarized
                        .into_iter()
                        .find(|m| !skipped.contains(m) && transcript_complete(&root, m))
                        .and_then(|m| {
                            let dir = crate::speech_models::speaker_dir()?;
                            match crate::speech_models::processing_config(&dir) {
                                Ok(config) => Some((m, config)),
                                Err(error) => {
                                    tracing::warn!("speaker models unusable: {error:#}");
                                    None
                                }
                            }
                        })
                } else {
                    None
                };
                let _ = send.send(Scan {
                    failed,
                    next,
                    diarize,
                });
            });
        if spawned.is_ok() {
            self.live.backlog.scan = Some(receive);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_newest_incomplete_recording_and_never_a_skipped_one() {
        let all: Vec<String> = ["new", "broken", "done", "old"].map(String::from).into();
        let complete = |m: &str| m == "done";
        let eligible = |m: &str| m != "broken";
        let none = BTreeSet::new();
        assert_eq!(
            choose(&all, &none, eligible, complete).as_deref(),
            Some("new")
        );
        let skipped = BTreeSet::from(["new".to_string()]);
        assert_eq!(
            choose(&all, &skipped, eligible, complete).as_deref(),
            Some("old")
        );
        let everything = BTreeSet::from(["new".to_string(), "old".to_string()]);
        assert_eq!(choose(&all, &everything, eligible, complete), None);
    }
}
