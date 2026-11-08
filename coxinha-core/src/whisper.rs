//! CPU-only baseline. Each job owns its model/state; no global inference lock.
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
#[derive(Debug, Serialize, Deserialize)]
pub struct Segment {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub text: String,
}
pub fn read_pcm16_mono(path: &Path) -> Result<Vec<f32>> {
    let mut wav = hound::WavReader::open(path)?;
    let spec = wav.spec();
    ensure!(
        spec.channels == 1
            && spec.sample_rate == 16000
            && spec.sample_format == hound::SampleFormat::Int
            && spec.bits_per_sample == 16,
        "Whisper input must be PCM16 mono 16kHz; normalize as a derived artifact first"
    );
    let samples = wav
        .samples::<i16>()
        .map(|s| s.map(|s| s as f32 / 32768.0))
        .collect::<Result<Vec<_>, _>>()?;
    ensure!(!samples.is_empty(), "empty Whisper input");
    Ok(samples)
}
pub fn transcribe_cpu(model: &Path, wav: &Path) -> Result<Vec<Segment>> {
    let samples = read_pcm16_mono(wav)?;
    let mut context_params = WhisperContextParameters::default();
    context_params.use_gpu(false);
    let ctx = WhisperContext::new_with_params(
        model.to_str().context("non UTF-8 model path")?,
        context_params,
    )
    .map_err(|e| anyhow::anyhow!("Whisper model: {e:?}"))?;
    let mut state = ctx.create_state()?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(None);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    state.full(params, &samples)?;
    let mut result = Vec::new();
    for i in 0..state.full_n_segments() {
        let s = state.get_segment(i).context("Whisper segment missing")?;
        result.push(Segment {
            start_seconds: s.start_timestamp() as f64 / 100.0,
            end_seconds: s.end_timestamp() as f64 / 100.0,
            text: s.to_str()?.trim().into(),
        });
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pcm_scaling_is_normalized_and_raw_track_rate_is_rejected() -> Result<()> {
        let d = tempfile::tempdir()?;
        let p = d.path().join("samples.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(&p, spec)?;
        for v in [i16::MIN, 0, i16::MAX] {
            w.write_sample(v)?;
        }
        w.finalize()?;
        assert_eq!(read_pcm16_mono(&p)?, vec![-1.0, 0.0, 32767.0 / 32768.0]);
        let mut w = hound::WavWriter::create(
            &p,
            hound::WavSpec {
                sample_rate: 48000,
                ..spec
            },
        )?;
        w.write_sample(0i16)?;
        w.finalize()?;
        assert!(read_pcm16_mono(&p).is_err());
        Ok(())
    }
}
