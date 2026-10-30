use super::*;
use crate::store::Store;
use anyhow::ensure;
pub fn preflight_processing(
    root: PathBuf,
    meeting: String,
    mut config: ProcessingConfig,
) -> Result<PreparedProcessing> {
    if config.parameters.is_null() {
        config.parameters = serde_json::json!({});
    }
    let parameters = config
        .parameters
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("parameters must be an object"))?;
    for (key, value) in [
        ("maximum_duration_seconds", serde_json::json!(1800)),
        ("cluster_cosine_threshold", serde_json::json!(0.75)),
        ("cluster_margin", serde_json::json!(0.08)),
        ("minimum_embedding_seconds", serde_json::json!(1.0)),
    ] {
        parameters.entry(key).or_insert(value);
    }
    uuid::Uuid::parse_str(&meeting)?;
    ensure!(
        !config.models.is_empty() && !config.engine_version.trim().is_empty(),
        "local models and engine version required"
    );
    for m in config.models.values() {
        crate::artifacts::validate_hash(&m.sha256)?;
        ensure!(!m.provenance.trim().is_empty(), "model provenance required");
        ensure!(
            crate::artifacts::digest(&m.path)?.0 == m.sha256,
            "model checksum mismatch"
        );
    }
    let root = root.canonicalize()?;
    let directory = root.join("raw").join(&meeting);
    let manifest_path = directory.join("manifest.json");
    ensure!(
        !manifest_path.symlink_metadata()?.file_type().is_symlink()
            && manifest_path.canonicalize()?.starts_with(&root),
        "raw manifest escapes library"
    );
    let manifest: crate::capture::CaptureManifest =
        serde_json::from_reader(std::fs::File::open(manifest_path)?)?;
    ensure!(
        matches!(manifest.version, 1 | 2)
            && manifest.meeting == meeting
            && matches!(manifest.state.as_str(), "finished" | "interrupted")
            && manifest.sample_rate == 48000
            && manifest.channels == 1,
        "expected closed mono 48 kHz capture"
    );
    let mut tracks = Vec::new();
    let paths = manifest.verified_tracks(&root)?;
    for (i, t) in manifest.tracks.iter().enumerate() {
        tracks.push(TrackInput {
            track: manifest.track_id(i)?.into(),
            path: paths[i].clone(),
            audio_sha256: t.sha256.clone().unwrap(),
            frames: t.frames,
            sample_rate: manifest.sample_rate,
        });
    }
    Ok(PreparedProcessing {
        meeting,
        job: String::new(),
        config,
        tracks,
    })
}
impl Store {
    pub fn prepare_processing(
        &self,
        meeting: &str,
        config: &ProcessingConfig,
    ) -> Result<PreparedProcessing> {
        self.prepare_verified_processing(preflight_processing(
            self.root.clone(),
            meeting.into(),
            config.clone(),
        )?)
    }
    pub fn prepare_verified_processing(
        &self,
        mut prepared: PreparedProcessing,
    ) -> Result<PreparedProcessing> {
        let active: i64 = self.db.query_row(
            "SELECT count(*) FROM meeting WHERE capture_state='recording'",
            [],
            |r| r.get(0),
        )?;
        ensure!(active == 0, "busy: capture active");
        let state: String = self.db.query_row(
            "SELECT capture_state FROM meeting WHERE id=?1",
            [&prepared.meeting],
            |r| r.get(0),
        )?;
        ensure!(
            matches!(state.as_str(), "finished" | "interrupted"),
            "capture must be closed"
        );
        let manifest: crate::capture::CaptureManifest =
            serde_json::from_reader(std::fs::File::open(
                self.root
                    .join("raw")
                    .join(&prepared.meeting)
                    .join("manifest.json"),
            )?)?;
        ensure!(
            manifest.state != "recording" && manifest.meeting == prepared.meeting,
            "capture changed after preflight"
        );
        validate_descriptors(&self.root, &prepared, &manifest)?;
        let input = crate::jobs::JobInput {
            artifact_sha256: hash_json(&manifest)?,
            config_sha256: hash_json(&prepared.config)?,
            model_sha256: hash_json(&prepared.config.models)?,
            engine_version: format!(
                "{}:{}",
                IMPLEMENTATION_VERSION, prepared.config.engine_version
            ),
        };
        let job = self.enqueue(&prepared.meeting, "local-processing", &input)?;
        self.db.execute(
            "INSERT INTO processing_run(job_id,config_json) VALUES(?1,?2) ON CONFLICT DO NOTHING",
            rusqlite::params![job, serde_json::to_string(&prepared.config)?],
        )?;
        prepared.job = job;
        Ok(prepared)
    }
}

pub(super) fn validate_descriptors(
    root: &std::path::Path,
    input: &PreparedProcessing,
    manifest: &crate::capture::CaptureManifest,
) -> Result<()> {
    ensure!(
        input.tracks.len() == manifest.tracks.len(),
        "raw track count mismatch"
    );
    let paths = manifest.verified_tracks(root)?;
    for (i, (t, m)) in input.tracks.iter().zip(&manifest.tracks).enumerate() {
        ensure!(
            t.track == manifest.track_id(i)?
                && t.path.canonicalize()? == paths[i]
                && t.audio_sha256 == m.sha256.clone().unwrap_or_default()
                && t.frames == m.frames
                && t.sample_rate == manifest.sample_rate,
            "prepared tracks differ from immutable manifest"
        );
    }
    Ok(())
}
pub fn validate_processing_source(input: &PreparedProcessing) -> Result<()> {
    validate_processing_source_controlled(input, &ProcessingControl::default())
}
pub(super) fn validate_processing_source_controlled(
    input: &PreparedProcessing,
    control: &ProcessingControl,
) -> Result<()> {
    control.check()?;
    for t in &input.tracks {
        let (hash, len) = control.digest(&t.path)?;
        ensure!(
            hash == t.audio_sha256
                && (t.track == "imported" || len == crate::artifacts::raw_bytes(t.frames)?),
            "raw source changed during processing"
        );
    }
    Ok(())
}
