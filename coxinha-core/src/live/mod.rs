//! Spec 0097 P3: live transcript from the recorder's committed checkpoints.
//!
//! One long-lived worker drains a FIFO of meetings with one resident model.
//! Its only output is `raw/<meeting>/outputs/live/transcript.jsonl`; it never
//! touches the Store, so an exit while it runs is a crash for ADR 0020.
mod dsp;
mod plan;
mod run;
#[cfg(feature = "stt-tagarela")]
mod tagarela;
mod timing;
mod transcript;
mod worker;

use serde::{Deserialize, Serialize};

#[cfg(feature = "stt-tagarela")]
pub use tagarela::TagarelaFactory;
pub use transcript::read_transcript;
pub use worker::LiveTranscriber;

/// A word with times in milliseconds relative to the start of the 16 kHz input.
#[derive(Clone, Debug, PartialEq)]
pub struct AsrWord {
    pub t0_ms: u32,
    pub t1_ms: u32,
    pub text: String,
}

/// One loaded speech model. Decoding is offline: one call per window.
pub trait Asr: Send {
    fn transcribe(&mut self, pcm16k: &[f32]) -> anyhow::Result<Vec<AsrWord>>;
}

/// Loads the model lazily on the worker thread, never on the caller's.
pub trait AsrFactory: Send + Sync {
    fn load(&self) -> anyhow::Result<Box<dyn Asr>>;
}

/// How the capture ended. Every state is terminal for the live transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EndState {
    Finished,
    Interrupted,
    Failed,
}

/// One committed window of one track.
///
/// `start_frame..end_frame` is the transcribed region of the raw WAV (48 kHz,
/// paused audio excluded); resume continues from the largest `end_frame`.
/// `start_ms..end_ms` spans the committed words on the track's capture clock,
/// with the paused frames before them added back, for display and ordering.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSegment {
    pub track: crate::capture::Track,
    pub start_frame: u64,
    pub end_frame: u64,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// Cheap view of the worker, copied from shared state.
///
/// `state` is one of `idle | loading | running | draining | paused | failed`.
/// After a failure, `meeting` and `error` name the failed meeting until the
/// next one starts. `behind_ms` is the largest per-track backlog of committed
/// frames not yet transcribed, as of the last checkpoint the worker read.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshot {
    pub meeting: Option<String>,
    pub state: String,
    pub error: Option<String>,
    pub behind_ms: u64,
    pub queued: Vec<String>,
}

#[cfg(test)]
#[path = "dsp_tests.rs"]
mod dsp_tests;
#[cfg(test)]
mod fake;
#[cfg(test)]
#[path = "plan_tests.rs"]
mod plan_tests;
#[cfg(test)]
#[path = "recorder_tests.rs"]
mod recorder_tests;
#[cfg(test)]
#[path = "transcript_tests.rs"]
mod transcript_tests;
#[cfg(test)]
#[path = "worker_tests.rs"]
mod worker_tests;
