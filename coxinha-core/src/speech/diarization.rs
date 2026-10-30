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
    clusters: Vec<Vec<f32>>,
    threshold: f32,
    margin: f32,
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
        let threshold = config
            .parameters
            .get("cluster_cosine_threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.75) as f32;
        let margin = config
            .parameters
            .get("cluster_margin")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.08) as f32;
        let minimum = config
            .parameters
            .get("minimum_embedding_seconds")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        ensure!(
            threshold.is_finite()
                && (0.0..=1.0).contains(&threshold)
                && margin.is_finite()
                && (0.0..=1.0).contains(&margin)
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
            clusters: vec![],
            threshold,
            margin,
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
                let mut space = None;
                let mut speaker = "unknown".to_string();
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
                    speaker = assign(&mut self.clusters, &vector, self.threshold, self.margin);
                    embedding = Some(vector);
                    space = Some(self.space.clone());
                }
                let count = powerset_multiplicity(class);
                for _ in 0..count {
                    result.turns.push(SpeakerTurn {
                        id: uuid::Uuid::new_v4().to_string(),
                        track: track.into(),
                        start_ms: ((offset + start) as u64 * 1000 / 16000),
                        end_ms: ((offset + end) as u64 * 1000 / 16000),
                        speaker: speaker.clone(),
                        embedding: embedding.clone(),
                        space: space.clone(),
                    });
                }
            }
        }
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
fn assign(clusters: &mut Vec<Vec<f32>>, vector: &[f32], threshold: f32, margin: f32) -> String {
    let mut scores: Vec<_> = clusters
        .iter()
        .enumerate()
        .map(|(i, c)| (i, c.iter().zip(vector).map(|(a, b)| a * b).sum::<f32>()))
        .collect();
    scores.sort_by(|a, b| b.1.total_cmp(&a.1));
    if let Some(&(best, score)) = scores.first() {
        if score >= threshold {
            if scores
                .get(1)
                .is_some_and(|(_, second)| score - second < margin)
            {
                return "unknown".into();
            }
            return format!("speaker-{}", best + 1);
        }
        // Borderline observations are not allowed to create a second identity.
        if score >= threshold - margin {
            return "unknown".into();
        }
    }
    clusters.push(vector.to_vec());
    format!("speaker-{}", clusters.len())
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
    fn embeddings_and_unbounded_anonymous_clusters() {
        let mut clusters = vec![];
        for i in 0..7 {
            let mut v = vec![0.0; 7];
            v[i] = 1.0;
            assert_eq!(
                assign(&mut clusters, &v, 0.75, 0.08),
                format!("speaker-{}", i + 1)
            );
        }
        assert_eq!(
            assign(
                &mut clusters,
                &[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                0.75,
                0.08
            ),
            "speaker-1"
        );
        assert!(normalize_embedding(vec![0.0]).is_err());
        assert!(normalize_embedding(vec![f32::NAN]).is_err());
    }
    #[test]
    fn ambiguous_embedding_abstains() {
        let mut clusters = vec![vec![1.0, 0.0], vec![0.99, 0.1]];
        assert_eq!(assign(&mut clusters, &[1.0, 0.0], 0.75, 0.08), "unknown");
    }
}
