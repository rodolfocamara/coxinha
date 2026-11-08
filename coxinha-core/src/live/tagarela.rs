//! Tagarela (Parakeet TDT, pt-BR) on the transcribe.cpp runtime, CPU only.
use super::{Asr, AsrFactory, AsrWord};
use anyhow::Result;
use std::path::PathBuf;
use transcribe_cpp::{Model, RunOptions, Session, SessionOptions, TimestampKind};

/// Very short tails are padded with silence; the encoder needs a few frames.
const MIN_SAMPLES: usize = 16_000;

pub struct TagarelaFactory {
    model_path: PathBuf,
    n_threads: u32,
}

impl TagarelaFactory {
    /// The model file is only read; the user's Handy copy is never modified.
    pub fn new(model_path: PathBuf, n_threads: u32) -> Self {
        Self {
            model_path,
            n_threads,
        }
    }
}

impl AsrFactory for TagarelaFactory {
    fn load(&self) -> Result<Box<dyn Asr>> {
        let model = Model::load(&self.model_path)?;
        let session = model.session_with(&SessionOptions {
            n_threads: i32::try_from(self.n_threads)?,
            ..SessionOptions::default()
        })?;
        Ok(Box::new(Tagarela {
            session,
            _model: model,
        }))
    }
}

struct Tagarela {
    session: Session,
    _model: Model,
}

impl Asr for Tagarela {
    fn transcribe(&mut self, pcm16k: &[f32]) -> Result<Vec<AsrWord>> {
        let mut padded;
        let pcm = if pcm16k.len() < MIN_SAMPLES {
            padded = pcm16k.to_vec();
            padded.resize(MIN_SAMPLES, 0.0);
            &padded[..]
        } else {
            pcm16k
        };
        let transcript = self.session.run(
            pcm,
            &RunOptions {
                timestamps: TimestampKind::Word,
                ..RunOptions::default()
            },
        )?;
        let ms = |t: i64| u32::try_from(t.max(0)).unwrap_or(u32::MAX);
        Ok(transcript
            .words
            .into_iter()
            .map(|w| AsrWord {
                t0_ms: ms(w.t0_ms),
                t1_ms: ms(w.t1_ms),
                text: w.text,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual: `cargo test -p coxinha-core --features stt-tagarela -- --ignored tagarela`.
    /// Loads the user's Handy model read-only and runs a tone and silence.
    #[test]
    #[ignore = "needs the local Tagarela model file"]
    fn tagarela_loads_and_runs_on_synthetic_audio() -> Result<()> {
        let path = std::env::var_os("COXINHA_TAGARELA_MODEL")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| {
                    PathBuf::from(home)
                        .join(".local/share/com.pais.handy/models/parakeet-v3-ptbr-tagarela-matched-q8.gguf")
                })
            })
            .expect("model path");
        let mut asr = TagarelaFactory::new(path, 4).load()?;
        let tone: Vec<f32> = (0..32_000)
            .map(|n| 0.1 * (2.0 * std::f32::consts::PI * 440.0 * n as f32 / 16_000.0).sin())
            .collect();
        let words = asr.transcribe(&tone)?;
        assert!(words.iter().all(|w| w.t0_ms <= w.t1_ms && w.t1_ms <= 2_000));
        asr.transcribe(&[0.0; 8_000])?;
        Ok(())
    }
}
