use crate::{
    identity::EmbeddingSpace,
    processing::{ProcessingConfig, ProcessingControl, ProcessingResult, SpeakerTurn},
};
use anyhow::{ensure, Context, Result};
use ort::{session::Session, value::Tensor};
use pyannote_rs::EmbeddingExtractor;

pub(super) struct Diarizer {
    session: Session,
    extractor: EmbeddingExtractor,
    space: EmbeddingSpace,
    clustering: super::clustering::Params,
    /// Labels already used by earlier tracks, so labels stay unique.
    labels: usize,
    min_samples: usize,
}
impl Diarizer {
    pub fn new(config: &ProcessingConfig) -> Result<Self> {
        let segmentation = &config.models["segmentation"];
        let embedding = &config.models["embedding"];
        let string = |key: &str| -> Result<String> {
            Ok(config
                .parameters
                .get(key)
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .with_context(|| format!("Required embedding metadata: {key}"))?
                .into())
        };
        let number = |key: &str, default: f64| {
            config
                .parameters
                .get(key)
                .and_then(|v| v.as_f64())
                .unwrap_or(default)
        };
        let distance = number("cluster_distance_threshold", 0.7);
        let reassign = number("cluster_reassign_distance", 0.5);
        let min_cluster = number("minimum_cluster_seconds", 10.0);
        let minimum = config
            .parameters
            .get("minimum_embedding_seconds")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        ensure!(
            (0.0..=2.0).contains(&distance)
                && (0.0..=2.0).contains(&reassign)
                && (0.0..=600.0).contains(&min_cluster)
                && minimum.is_finite()
                && (0.5..=10.0).contains(&minimum),
            "Invalid experimental clustering parameters"
        );
        initialize_runtime(config)?;
        // ort load-dynamic panics on a missing/incompatible native library.
        // Keep this as a visible retryable job failure instead of a worker crash.
        let session = std::panic::catch_unwind(|| -> Result<Session> {
            Ok(Session::builder()?.with_intra_threads(1)?.with_inter_threads(1)?
                .commit_from_file(&segmentation.path)?)
        }).map_err(|_| anyhow::anyhow!("ONNX Runtime unavailable or incompatible. Install the CPU runtime compatible with ort rc.10 and set ORT_DYLIB_PATH to its local library; automatic downloads are disabled"))??;
        Ok(Self {
            session,
            extractor: EmbeddingExtractor::new(&embedding.path)
                .map_err(|e| anyhow::anyhow!("Load WeSpeaker model: {e}"))?,
            space: EmbeddingSpace {
                model: string("embedding_family")?,
                revision: string("embedding_revision")?,
                model_hash: embedding.sha256.clone(),
                preprocessing: "pcm16-48k-fir97-7khz-decimate3-knf-fbank80-v1".into(),
                dimension: 0,
            },
            clustering: super::clustering::Params {
                distance: distance as f32,
                min_cluster_ms: (min_cluster * 1000.0) as u64,
                reassign_distance: reassign as f32,
            },
            labels: 0,
            min_samples: (minimum * 16000.0) as usize,
        })
    }
    pub fn process(
        &mut self,
        samples: &[f32],
        track: &str,
        result: &mut ProcessingResult,
        control: &ProcessingControl,
    ) -> Result<()> {
        // Turns of the whole track first: clustering needs every embedding.
        let mut pending: Vec<(u64, u64, usize, Option<Vec<f32>>)> = Vec::new();
        for (window_index, window) in samples.chunks(160000).enumerate() {
            control.check()?;
            let offset = window_index * 160000;
            let mut padded = vec![0.0f32; 160000];
            padded[..window.len()].copy_from_slice(window);
            let output = self.session.run(ort::inputs![Tensor::from_array((
                [1usize, 1, 160000],
                padded
            ))?])?;
            control.check()?;
            let tensor = output
                .get("logits")
                .or_else(|| output.get("output"))
                .context("Segmentation must expose logits or output")?;
            let (shape, values) = tensor.try_extract_tensor::<f32>()?;
            ensure!(
                shape.len() == 3 && shape[0] == 1 && shape[1] == 589 && shape[2] == 7,
                "Expected segmentation-3.0 powerset output [1,frames,7]"
            );
            ensure!(
                values.iter().all(|v| v.is_finite()),
                "Non-finite segmentation output"
            );
            // Primary sources: pyannote-audio 3.3.2 models/blocks/sincnet.py
            // and utils/powerset.py. Kernels [251,3,5,3,5,3], strides
            // [10,3,1,3,1,3] give RF991 and hop270.
            // Segmentation-3.0: receptive field 991 samples, stride 270; first
            // frame center 495. A frame's decision interval is centered on that center.
            let mut runs: Vec<(usize, usize, usize)> = vec![];
            for (frame, row) in values.as_chunks::<7>().0.iter().enumerate() {
                let class = row
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(b.1))
                    .unwrap()
                    .0;
                let (start, end) = frame_bounds(frame, window.len());
                if start >= end || class == 0 {
                    continue;
                }
                if let Some(last) = runs.last_mut() {
                    if last.2 == class && last.1 == start {
                        last.1 = end;
                        continue;
                    }
                }
                runs.push((start, end, class));
            }
            drop(output);
            for (start, end, class) in runs {
                control.check()?;
                // Powerset classes: empty, {0},{1},{2},{0,1},{0,2},{1,2}.
                // Local speaker slots reset each window; only clean embeddings can link them.
                let overlap = class >= 4;
                let mut embedding = None;
                if !overlap && end - start >= self.min_samples {
                    let pcm: Vec<i16> = window[start..end]
                        .iter()
                        .map(|v| (v.clamp(-1.0, 32767.0 / 32768.0) * 32768.0).round() as i16)
                        .collect();
                    let vector: Vec<f32> = self
                        .extractor
                        .compute(&pcm)
                        .map_err(|e| anyhow::anyhow!("WeSpeaker inference: {e}"))?
                        .collect();
                    control.check()?;
                    let vector = normalize_embedding(vector)?;
                    if self.space.dimension == 0 {
                        self.space.dimension = vector.len();
                    }
                    ensure!(
                        self.space.dimension == vector.len(),
                        "Embedding dimension changed"
                    );
                    embedding = Some(vector);
                }
                pending.push((
                    (offset + start) as u64 * 1000 / 16000,
                    (offset + end) as u64 * 1000 / 16000,
                    powerset_multiplicity(class),
                    embedding,
                ));
            }
        }
        let embedded: Vec<usize> = (0..pending.len())
            .filter(|i| pending[*i].3.is_some())
            .collect();
        let vectors: Vec<Vec<f32>> = embedded
            .iter()
            .filter_map(|i| pending[*i].3.clone())
            .collect();
        let durations: Vec<u64> = embedded
            .iter()
            .map(|i| pending[*i].1 - pending[*i].0)
            .collect();
        let mut labels = vec![None; pending.len()];
        for (i, label) in embedded.iter().zip(super::clustering::cluster(
            &vectors,
            &durations,
            &self.clustering,
        )) {
            labels[*i] = label;
        }
        let used = labels.iter().flatten().max().map_or(0, |m| m + 1);
        for ((start_ms, end_ms, count, embedding), label) in pending.into_iter().zip(labels) {
            let speaker = label.map_or("unknown".into(), |l| {
                format!("speaker-{}", self.labels + l + 1)
            });
            let space = embedding.as_ref().map(|_| self.space.clone());
            for _ in 0..count {
                result.turns.push(SpeakerTurn {
                    id: uuid::Uuid::new_v4().to_string(),
                    track: track.into(),
                    start_ms,
                    end_ms,
                    speaker: speaker.clone(),
                    embedding: embedding.clone(),
                    space: space.clone(),
                });
            }
        }
        self.labels += used;
        Ok(())
    }
}
fn initialize_runtime(config: &ProcessingConfig) -> Result<()> {
    use std::sync::{Mutex, OnceLock};
    static RUNTIME: OnceLock<Mutex<Option<(std::path::PathBuf, String)>>> = OnceLock::new();
    let model = config
        .models
        .get("onnxruntime")
        .context("Select a local onnxruntime CPU shared library with checksum and provenance")?;
    let path =
        std::fs::canonicalize(&model.path).context("Local ONNX Runtime library unavailable")?;
    let mut loaded = RUNTIME
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| {
            anyhow::anyhow!("ONNX Runtime initialization lock poisoned; restart processing worker")
        })?;
    if let Some((existing, hash)) = loaded.as_ref() {
        ensure!(
            existing == &path && hash == &model.sha256,
            "Switching ONNX Runtime libraries requires restarting the application"
        );
        return Ok(());
    }
    let committed = std::panic::catch_unwind(||ort::init_from(path.to_string_lossy()).commit())
        .map_err(|_|anyhow::anyhow!("Cannot load selected ONNX Runtime CPU library; verify platform and ort rc.10 compatibility"))??;
    ensure!(committed,"ONNX Runtime was initialized outside the configured profile; restart application before selecting a pinned runtime");
    *loaded = Some((path, model.sha256.clone()));
    Ok(())
}
fn frame_bounds(frame: usize, samples: usize) -> (usize, usize) {
    (
        (360 + frame * 270).min(samples),
        (630 + frame * 270).min(samples),
    )
}
fn powerset_multiplicity(class: usize) -> usize {
    match class {
        0 => 0,
        1..=3 => 1,
        4..=6 => 2,
        _ => 0,
    }
}
fn normalize_embedding(mut vector: Vec<f32>) -> Result<Vec<f32>> {
    ensure!(
        !vector.is_empty() && vector.iter().all(|v| v.is_finite()),
        "Invalid embedding values"
    );
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    ensure!(norm.is_finite() && norm > 1e-8, "Zero embedding norm");
    for v in &mut vector {
        *v /= norm;
    }
    Ok(vector)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_use_window_offsets_and_overlap_is_retained() {
        assert_eq!(frame_bounds(0, 160000), (360, 630));
        assert_eq!(frame_bounds(588, 160000), (159120, 159390));
        assert_eq!(frame_bounds(2, 1000), (900, 1000));
        assert_eq!((160000 + frame_bounds(0, 160000).0) * 1000 / 16000, 10022);
        assert_eq!(
            (0..7).map(powerset_multiplicity).collect::<Vec<_>>(),
            vec![0, 1, 1, 1, 2, 2, 2]
        );
    }

    #[test]
    fn embeddings_must_be_finite_and_non_zero() {
        assert!(normalize_embedding(vec![0.0]).is_err());
        assert!(normalize_embedding(vec![f32::NAN]).is_err());
        assert!(normalize_embedding(vec![3.0, 4.0]).is_ok());
    }
}
