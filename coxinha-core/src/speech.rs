//! Explicitly configured, offline CPU inference. Anonymous clustering is experimental.
#[cfg(feature = "stt-whisper")]
mod abort;
#[cfg(feature = "diarization-onnx")]
mod diarization;
mod dsp;
#[cfg(feature = "stt-whisper")]
use crate::processing::TranscriptSegment;
use crate::processing::{
    PreparedProcessing, ProcessingControl, ProcessingEngine, ProcessingResult,
};
use anyhow::{ensure, Context, Result};

#[derive(Default)]
pub struct LocalSpeechEngine;
impl ProcessingEngine for LocalSpeechEngine {
    fn run(&mut self, input: PreparedProcessing) -> Result<ProcessingResult> {
        self.run_controlled(input, &ProcessingControl::default())
    }
    fn run_controlled(
        &mut self,
        input: PreparedProcessing,
        control: &ProcessingControl,
    ) -> Result<ProcessingResult> {
        control.check()?;
        ensure!(
            !input.config.models.is_empty(),
            "Select local Whisper and/or segmentation plus embedding models"
        );
        for model in input.config.models.values() {
            ensure!(
                control
                    .digest(&model.path)
                    .context("Read local model; automatic downloads are disabled")?
                    .0
                    == model.sha256.to_lowercase(),
                "Local model checksum mismatch: {}",
                model.path.display()
            );
            ensure!(
                !model.provenance.trim().is_empty(),
                "Model provenance is required"
            );
        }
        let whisper = input.config.models.get("whisper");
        let diarization = input.config.models.contains_key("segmentation");
        ensure!(
            diarization == input.config.models.contains_key("embedding"),
            "Select both segmentation and embedding models"
        );
        ensure!(
            whisper.is_some() || diarization,
            "No supported local model selected"
        );
        #[cfg(not(feature = "stt-whisper"))]
        if whisper.is_some() {
            anyhow::bail!("Whisper engine unavailable: build with stt-whisper");
        }
        #[cfg(not(feature = "diarization-onnx"))]
        if diarization {
            anyhow::bail!("Diarization engine unavailable: build with diarization-onnx");
        }
        let mut result = ProcessingResult {
            segments: vec![],
            turns: vec![],
            warnings: vec![],
        };
        control.check()?;
        #[cfg(feature = "diarization-onnx")]
        let mut diarizer = if diarization {
            Some(diarization::Diarizer::new(&input.config)?)
        } else {
            None
        };
        let max_seconds = input
            .config
            .parameters
            .get("maximum_duration_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(1800);
        ensure!(
            (1..=7200).contains(&max_seconds),
            "maximum_duration_seconds must be 1..7200"
        );
        for track in &input.tracks {
            control.check()?;
            let samples = dsp::normalize_controlled(&track.path, max_seconds, control)?;
            ensure!(
                samples.len().abs_diff((track.frames as usize).div_ceil(3)) <= 1,
                "Track frame metadata differs from audio"
            );
            if samples.iter().all(|sample| *sample == 0.0) {
                result.warnings.push(format!(
                    "Track {} contains digital silence; inference skipped",
                    track.track
                ));
                continue;
            }
            #[cfg(feature = "stt-whisper")]
            if let Some(model) = whisper {
                transcribe(
                    model.path.as_path(),
                    &samples,
                    track.track.as_str(),
                    &mut result,
                    control,
                )?;
            }
            #[cfg(feature = "diarization-onnx")]
            if let Some(engine) = diarizer.as_mut() {
                engine.process(&samples, &track.track, &mut result, control)?;
            }
        }
        if diarization {
            result.warnings.push("Experimental anonymous clustering; similarity thresholds are parameters, not calibrated confidence. Overlap and ambiguous speech retain unknown attribution.".into());
        }
        control.check()?;
        crate::processing::attribute_segments(&mut result.segments, &result.turns);
        result.warnings.push("Text attribution overlap-v2: same track, union coverage >=70%, abstain on competing/unknown speech; not confidence.".into());
        control.check()?;
        Ok(result)
    }
}
#[cfg(feature = "stt-whisper")]
fn transcribe(
    model: &std::path::Path,
    samples: &[f32],
    track: &str,
    result: &mut ProcessingResult,
    control: &ProcessingControl,
) -> Result<()> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    let mut options = WhisperContextParameters::default();
    options.use_gpu(false);
    let context =
        WhisperContext::new_with_params(model.to_str().context("Non UTF-8 model path")?, options)?;
    control.check()?;
    let mut state = context.create_state()?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(None);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    abort::run(&mut state, params, samples, control)?;
    for index in 0..state.full_n_segments() {
        let segment = state
            .get_segment(index)
            .context("Missing Whisper segment")?;
        let duration = samples.len() as u64 * 1000 / 16000;
        let start = (segment.start_timestamp().max(0) as u64 * 10).min(duration);
        let end = (segment.end_timestamp().max(0) as u64 * 10).min(duration);
        let text = segment.to_str()?.trim().to_owned();
        if start < end && !text.is_empty() {
            result.segments.push(TranscriptSegment {
                id: uuid::Uuid::new_v4().to_string(),
                track: track.into(),
                start_ms: start,
                end_ms: end,
                text,
                speaker: None,
            });
        }
    }
    Ok(())
}
