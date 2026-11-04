use super::*;
use anyhow::{ensure, Context};
use coxinha_core::capture::CaptureManifest;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

pub(super) struct Grant {
    pub file: File,
    pub length: u64,
    pub expires: Instant,
    pub revoked: AtomicBool,
    pub(super) identity: (u64, u64, String),
}

impl Grant {
    pub(super) fn active(&self) -> bool {
        !self.revoked.load(Ordering::Acquire) && Instant::now() < self.expires
    }
}

impl NativeAudio {
    /// Only command results from the canonical library verifier reach this method.
    /// There is deliberately no HTTP or IPC endpoint that takes a file path.
    pub(crate) fn grant_detail(&self, mut detail: Value) -> anyhow::Result<Value> {
        if detail["audio"].is_null() {
            return Ok(detail);
        }
        let manifest: CaptureManifest = serde_json::from_value(detail["manifest"].clone())?;
        ensure!(
            detail["meeting"]["id"] == manifest.meeting,
            "invalid audio detail"
        );
        ensure!(
            matches!(manifest.state.as_str(), "finished" | "interrupted"),
            "audio is not closed"
        );
        let audio = detail["audio"].as_object().context("invalid audio map")?;
        ensure!(
            audio.len() == manifest.tracks.len(),
            "invalid audio track count"
        );
        let mut opened = Vec::new();
        for (index, track) in manifest.tracks.iter().enumerate() {
            let track_id = manifest.track_id(index)?;
            let path = Path::new(
                audio
                    .get(track_id)
                    .and_then(Value::as_str)
                    .context("missing audio track")?,
            );
            let hash = track.sha256.as_deref().context("unverified audio")?;
            opened.push((
                track_id.to_string(),
                open_verified(path, hash, track.frames)?,
            ));
        }
        let lifetime = self.lifetime.lock().unwrap_or_else(|e| e.into_inner());
        ensure!(lifetime.is_some(), "audio transport stopped");
        let mut registry = self.server.grants.lock().unwrap_or_else(|e| e.into_inner());
        registry.retain(|_, grant| grant.active());
        let needed = opened
            .iter()
            .filter(|(_, grant)| !registry.values().any(|old| old.identity == grant.identity))
            .count();
        ensure!(
            registry.len() + needed <= MAX_GRANTS,
            "audio capability limit reached"
        );
        let mut urls = serde_json::Map::new();
        for (track, grant) in opened {
            let token = registry
                .iter()
                .find(|(_, old)| old.identity == grant.identity)
                .map(|(token, _)| token.clone())
                .unwrap_or_else(|| {
                    let token = format!(
                        "{}{}",
                        uuid::Uuid::new_v4().simple(),
                        uuid::Uuid::new_v4().simple()
                    );
                    registry.insert(token.clone(), Arc::new(grant));
                    token
                });
            urls.insert(
                track,
                json!(format!(
                    "http://{}/audio/{token}.wav",
                    self.server.authority
                )),
            );
        }
        detail["audio"] = Value::Object(urls);
        Ok(detail)
    }
}

fn open_verified(path: &Path, hash: &str, frames: u64) -> anyhow::Result<Grant> {
    // Pin an opened inode, closing the path replacement window between validation and playback.
    let before = path
        .symlink_metadata()
        .context("audio metadata unavailable")?;
    ensure!(
        before.is_file() && path.canonicalize().ok().as_deref() == Some(path),
        "audio path is not an owned regular file"
    );
    let mut file = File::open(path).context("audio file unavailable")?;
    let metadata = file.metadata().context("audio descriptor unavailable")?;
    ensure!(
        metadata.is_file() && (before.dev(), before.ino()) == (metadata.dev(), metadata.ino()),
        "audio file changed"
    );
    let mut digest = Sha256::new();
    let mut buffer = [0; CHUNK];
    let mut remaining = metadata.len();
    while remaining > 0 {
        let count = remaining.min(CHUNK as u64) as usize;
        let read = file
            .read(&mut buffer[..count])
            .context("audio verification failed")?;
        ensure!(read > 0, "audio truncated during verification");
        digest.update(&buffer[..read]);
        remaining -= read as u64;
    }
    ensure!(
        format!("{:x}", digest.finalize()) == hash,
        "audio checksum mismatch"
    );
    file.seek(SeekFrom::Start(0))?;
    let wav = hound::WavReader::new(&file).context("invalid audio WAV")?;
    let spec = wav.spec();
    ensure!(
        spec.channels == 1
            && spec.sample_rate == 48000
            && spec.bits_per_sample == 16
            && spec.sample_format == hound::SampleFormat::Int
            && wav.duration() as u64 == frames,
        "audio WAV metadata mismatch"
    );
    let after = file.metadata()?;
    ensure!(
        metadata.len() == after.len()
            && metadata.mtime() == after.mtime()
            && metadata.mtime_nsec() == after.mtime_nsec()
            && metadata.ctime() == after.ctime()
            && metadata.ctime_nsec() == after.ctime_nsec(),
        "audio changed during verification"
    );
    Ok(Grant {
        file,
        length: metadata.len(),
        identity: (metadata.dev(), metadata.ino(), hash.into()),
        expires: Instant::now() + GRANT_LIFETIME,
        revoked: AtomicBool::new(false),
    })
}
