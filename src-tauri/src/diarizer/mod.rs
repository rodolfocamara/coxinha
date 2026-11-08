//! `Diarizer` trait with pluggable implementations.
//!
//! Applies speaker labels to already-transcribed segments, or emits
//! segments from scratch and merges them with the transcript.

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use shared::*;

pub mod none;
#[cfg(feature = "diarize-pyannote")]
pub mod pyannote;
// #[cfg(feature = "diarize-speakrs")]
// pub mod speakrs;

#[async_trait]
pub trait Diarizer: Send + Sync {
    /// Annotate existing segments with speaker labels inferred from audio.
    /// Wired into the meeting pipeline by spec 0008 — the trait exists
    /// today so the factory + config types are real.
    #[allow(dead_code)]
    #[must_use = "Await diarization to obtain speaker annotations."]
    async fn diarize(
        &self,
        wav: &Path,
        segments: Vec<TranscriptSegment>,
    ) -> Result<Vec<TranscriptSegment>>;
}

pub fn build(config: &DiarizerConfig) -> Result<Arc<dyn Diarizer>> {
    match config {
        DiarizerConfig::None => Ok(Arc::new(none::NoneDiarizer)),

        DiarizerConfig::Pyannote {
            segmentation_model,
            embedding_model,
        } => {
            #[cfg(feature = "diarize-pyannote")]
            {
                Ok(Arc::new(pyannote::PyannoteDiarizer::new(
                    segmentation_model.into(),
                    embedding_model.into(),
                )?))
            }
            #[cfg(not(feature = "diarize-pyannote"))]
            {
                let _ = (segmentation_model, embedding_model);
                tracing::warn!("diarize-pyannote not compiled; falling back to None");
                Ok(Arc::new(none::NoneDiarizer))
            }
        }

        DiarizerConfig::Speakrs {
            model_dir,
            accelerator,
        } => {
            let _ = (model_dir, accelerator);
            tracing::warn!("speakrs not yet implemented; falling back to None");
            Ok(Arc::new(none::NoneDiarizer))
        }
    }
}
