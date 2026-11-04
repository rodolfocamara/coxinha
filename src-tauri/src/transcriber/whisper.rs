//! Whisper implementation via `whisper-rs` (whisper.cpp binding).
//!
//! Uses whisper.cpp GGML models. Recommended downloads:
//! `ggml-base.bin`, `ggml-small.bin`, `ggml-medium.bin`, `ggml-large-v3.bin`
//! See https://huggingface.co/ggerganov/whisper.cpp/tree/main

#![cfg(feature = "stt-whisper")]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use async_trait::async_trait;
use shared::*;
use whisper_rs::WhisperContext;

use super::Transcriber;

pub struct WhisperTranscriber {
    model_path: PathBuf,
    accelerator: Accelerator,
    // Loaded on first use, then reused across calls.
    ctx: Arc<Mutex<Option<Arc<WhisperContext>>>>,
}

impl WhisperTranscriber {
    pub fn new(model_path: PathBuf, accelerator: Accelerator) -> Result<Self> {
        if !model_path.exists() {
            tracing::warn!(
                "Whisper model not found at {} — transcription will fail until downloaded",
                model_path.display()
            );
        }
        anyhow::ensure!(
            matches!(accelerator, Accelerator::Cpu)
                || (matches!(accelerator, Accelerator::Cuda) && cfg!(feature = "cuda")),
            "Whisper supports CPU or compiled CUDA in this adapter"
        );
        Ok(Self {
            model_path,
            accelerator,
            ctx: Arc::new(Mutex::new(None)),
        })
    }

    fn load(&self) -> Result<Arc<WhisperContext>> {
        let mut guard = self.ctx.lock().unwrap();
        if let Some(ctx) = guard.as_ref() {
            return Ok(ctx.clone());
        }
        let mut params = whisper_rs::WhisperContextParameters::default();
        params.use_gpu(matches!(self.accelerator, Accelerator::Cuda));
        let path = self.model_path.to_str().context("non-UTF8 model path")?;
        let ctx = WhisperContext::new_with_params(path, params)
            .map_err(|e| anyhow::anyhow!("whisper load: {:?}", e))?;
        let ctx = Arc::new(ctx);
        *guard = Some(ctx.clone());
        Ok(ctx)
    }
}

#[async_trait]
impl Transcriber for WhisperTranscriber {
    async fn transcribe_file(&self, wav: &Path) -> Result<TranscriptBody> {
        let wav = wav.to_path_buf();
        let ctx = self.load()?;
        let _acc = self.accelerator;

        tokio::task::spawn_blocking(move || -> Result<TranscriptBody> {
            use whisper_rs::{FullParams, SamplingStrategy};

            let mut state = ctx.create_state().map_err(|e| anyhow::anyhow!("{:?}", e))?;

            let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            p.set_print_progress(false);
            p.set_print_realtime(false);
            p.set_print_special(false);
            p.set_language(Some("auto"));

            let samples = read_wav_16k_mono(&wav)?;

            state
                .full(p, &samples)
                .map_err(|e| anyhow::anyhow!("whisper full: {:?}", e))?;

            let n = state.full_n_segments();
            let mut segments = Vec::with_capacity(n as usize);
            for i in 0..n {
                let segment = state.get_segment(i).context("missing Whisper segment")?;
                let text = segment.to_str()?;
                let t0 = segment.start_timestamp() as f32 / 100.0;
                let t1 = segment.end_timestamp() as f32 / 100.0;
                segments.push(TranscriptSegment {
                    start: t0,
                    end: t1,
                    text: text.trim().to_string(),
                    speaker: None,
                    confidence: None,
                });
            }

            Ok(TranscriptBody {
                language: None,
                segments,
            })
        })
        .await?
    }
}

fn read_wav_16k_mono(path: &Path) -> Result<Vec<f32>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    if spec.sample_rate != 16_000 {
        anyhow::bail!(
            "wav must be 16kHz (got {}); convert upstream",
            spec.sample_rate
        );
    }
    anyhow::ensure!(
        spec.channels > 0
            && spec.bits_per_sample == 16
            && spec.sample_format == hound::SampleFormat::Int,
        "WAV must contain PCM16 samples"
    );
    let samples: Result<Vec<i16>, _> = reader.samples::<i16>().collect();
    let samples = samples?;
    let mut mono: Vec<f32> = if spec.channels == 1 {
        samples.iter().map(|s| *s as f32 / 32768.0).collect()
    } else {
        // Simple downmix
        samples
            .chunks(spec.channels as usize)
            .map(|c| c.iter().map(|s| *s as f32 / 32768.0).sum::<f32>() / spec.channels as f32)
            .collect()
    };
    for s in mono.iter_mut() {
        *s = s.clamp(-1.0, 1.0);
    }
    Ok(mono)
}
