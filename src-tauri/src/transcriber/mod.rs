//! `Transcriber` trait with pluggable implementations.
//!
//! Selection via `config.toml`:
//! ```toml
//! [transcriber]
//! engine = "parakeet"  # or "whisper"
//! model_dir = "~/coxinha/.coxinha/models/parakeet-tdt-0.6b-v3-int8"
//! accelerator = "cuda"
//! ```

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use shared::*;

pub mod parakeet;
pub mod whisper;

/// Common interface. All impls are `Send + Sync` so they can live
/// inside an `Arc`.
#[async_trait]
pub trait Transcriber: Send + Sync {
    /// Transcribe a WAV file (16kHz mono expected). The returned
    /// `TranscriptBody` carries segments + optional language; the
    /// caller attaches the meeting id.
    ///
    /// Called from the meeting pipeline (spec 0008) — trait + factory
    /// exist today so config is type-checked against the real surface.
    #[allow(dead_code)]
    #[must_use = "Await transcription to obtain the transcript."]
    async fn transcribe_file(&self, wav: &Path) -> Result<TranscriptBody>;
}

/// Stand-in used when the configured engine isn't available — either
/// because the user picked `TranscriberConfig::None` or because the
/// build didn't include the selected feature. Note-taking keeps
/// working; only `transcribe_meeting` surfaces the error.
pub struct NoopTranscriber {
    reason: String,
}

impl NoopTranscriber {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

#[async_trait]
impl Transcriber for NoopTranscriber {
    async fn transcribe_file(&self, _wav: &Path) -> Result<TranscriptBody> {
        anyhow::bail!("transcriber not configured: {}", self.reason)
    }
}

pub fn build(config: &TranscriberConfig) -> Result<Arc<dyn Transcriber>> {
    match config {
        TranscriberConfig::None => Ok(Arc::new(NoopTranscriber::new(
            "no engine selected (set [transcriber] in config.toml)",
        ))),
        TranscriberConfig::Whisper {
            model_path,
            accelerator,
        } => {
            #[cfg(feature = "stt-whisper")]
            {
                Ok(Arc::new(whisper::WhisperTranscriber::new(
                    model_path.into(),
                    *accelerator,
                )?))
            }
            #[cfg(not(feature = "stt-whisper"))]
            {
                let _ = (model_path, accelerator);
                tracing::warn!(
                    "config requests Whisper but the `stt-whisper` feature \
                     wasn't compiled in — using noop transcriber"
                );
                Ok(Arc::new(NoopTranscriber::new(
                    "stt-whisper feature not enabled at compile time",
                )))
            }
        }
        TranscriberConfig::Parakeet {
            model_dir,
            accelerator,
        } => {
            #[cfg(feature = "stt-parakeet")]
            {
                Ok(Arc::new(parakeet::ParakeetTranscriber::new(
                    model_dir.into(),
                    *accelerator,
                )?))
            }
            #[cfg(not(feature = "stt-parakeet"))]
            {
                let _ = (model_dir, accelerator);
                tracing::warn!(
                    "config requests Parakeet but the `stt-parakeet` feature \
                     wasn't compiled in — using noop transcriber"
                );
                Ok(Arc::new(NoopTranscriber::new(
                    "stt-parakeet feature not enabled at compile time",
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_returns_noop_for_none_variant() {
        let t = build(&TranscriberConfig::None).expect("noop builds");
        // Sanity: calling the trait does not panic and surfaces an error.
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(async { t.transcribe_file(Path::new("nope.wav")).await })
            .unwrap_err();
        assert!(err.to_string().contains("not configured"));
    }

    #[test]
    fn build_falls_back_to_noop_when_whisper_feature_missing() {
        // In the default test profile we build with --no-default-features,
        // so the whisper branch must not panic/error — it must fall back.
        let cfg = TranscriberConfig::Whisper {
            model_path: "/nowhere/model.bin".into(),
            accelerator: shared::Accelerator::Cpu,
        };
        // If the feature happens to be enabled, this still succeeds with
        // a real engine; we only assert that `build` doesn't error.
        build(&cfg).expect("build should not error when feature is absent");
    }
}
