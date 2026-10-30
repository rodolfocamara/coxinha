//! Durable local inference boundary. Public results never contain voice vectors.
use crate::identity::EmbeddingSpace;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};
mod alignment;
mod control;
pub use control::{ProcessingCancelled, ProcessingControl};
mod persistence;
mod publication;
pub use alignment::attribute_segments;
pub use persistence::{AssignmentView, ProcessingReport};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelFile {
    pub path: PathBuf,
    pub sha256: String,
    pub provenance: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcessingConfig {
    pub engine_version: String,
    pub models: BTreeMap<String, ModelFile>,
    pub parameters: serde_json::Value,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrackInput {
    pub track: String,
    pub path: PathBuf,
    pub audio_sha256: String,
    pub frames: u64,
    pub sample_rate: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedProcessing {
    pub meeting: String,
    pub job: String,
    pub config: ProcessingConfig,
    pub tracks: Vec<TrackInput>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub track: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub speaker: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpeakerTurn {
    pub id: String,
    pub track: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space: Option<EmbeddingSpace>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcessingResult {
    pub segments: Vec<TranscriptSegment>,
    pub turns: Vec<SpeakerTurn>,
    pub warnings: Vec<String>,
}
pub trait ProcessingEngine: Send + 'static {
    fn run(&mut self, input: PreparedProcessing) -> Result<ProcessingResult>;

    /// Legacy engines can finish their call before observing cancellation. The
    /// caller must retain ownership until this returns; no latency is implied.
    fn run_controlled(
        &mut self,
        input: PreparedProcessing,
        control: &ProcessingControl,
    ) -> Result<ProcessingResult> {
        control.check()?;
        let result = self.run(input);
        control.check()?;
        result
    }
}

/// Synchronous boundary for a worker that owns its thread and completion handle.
/// A cancellation request rejects the result even if an engine ignores the token.
pub fn run_processing_controlled<E: ProcessingEngine>(
    input: PreparedProcessing,
    mut engine: E,
    control: &ProcessingControl,
) -> Result<ProcessingResult> {
    prepare::validate_processing_source_controlled(&input, control)?;
    let result = engine.run_controlled(input.clone(), control);
    control.check()?;
    let result = result?;
    prepare::validate_processing_source_controlled(&input, control)?;
    control.check()?;
    Ok(result)
}
pub fn execute_processing<E: ProcessingEngine>(
    input: PreparedProcessing,
    engine: E,
) -> std::thread::JoinHandle<Result<ProcessingResult>> {
    std::thread::spawn(move || {
        run_processing_controlled(input, engine, &ProcessingControl::default())
    })
}
pub(crate) fn hash_json(value: &impl Serialize) -> Result<String> {
    use sha2::{Digest, Sha256};
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
mod prepare;
pub use prepare::{preflight_processing, validate_processing_source};
pub const IMPLEMENTATION_VERSION: &str =
    "local-processing-v2-overlap70-whisper016-pyannote034-dsp1";

#[cfg(test)]
mod tests;

#[cfg(test)]
mod increment_tests;

#[cfg(test)]
mod control_tests;

#[cfg(test)]
mod publication_tests;
