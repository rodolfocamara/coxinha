//! Diarization via `pyannote-rs`.
//!
//! Pipeline:
//! 1. `segmentation-3.0.onnx` detects speech segments
//! 2. `wespeaker-voxceleb-resnet34-LM.onnx` generates a per-segment embedding
//! 3. Clustering via cosine similarity
//!
//! Model downloads:
//! ```bash
//! # segmentation-3.0
//! wget -P ~/coxinha/.coxinha/models/ \
//!   https://github.com/thewh1teagle/pyannote-rs/releases/download/v0.1.0/segmentation-3.0.onnx
//! # wespeaker
//! wget -P ~/coxinha/.coxinha/models/ \
//!   https://github.com/thewh1teagle/pyannote-rs/releases/download/v0.1.0/wespeaker_en_voxceleb_CAM++.onnx
//! ```

#![cfg(feature = "diarize-pyannote")]

use std::path::{Path, PathBuf};

use anyhow::Result;
use async_trait::async_trait;
use shared::*;

use super::Diarizer;

pub struct PyannoteDiarizer {
    segmentation_model: PathBuf,
    embedding_model: PathBuf,
}

impl PyannoteDiarizer {
    pub fn new(segmentation_model: PathBuf, embedding_model: PathBuf) -> Result<Self> {
        Ok(Self {
            segmentation_model,
            embedding_model,
        })
    }
}

#[async_trait]
impl Diarizer for PyannoteDiarizer {
    async fn diarize(
        &self,
        wav: &Path,
        segments: Vec<TranscriptSegment>,
    ) -> Result<Vec<TranscriptSegment>> {
        let _ = (
            wav,
            segments,
            &self.segmentation_model,
            &self.embedding_model,
        );
        anyhow::bail!(
            "pyannote adapter is not implemented; no diarization output produced (spec 0058)"
        )
    }
}
