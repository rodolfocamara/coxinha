//! Versioned raw-source validation and owned single-file import.
use super::{CaptureManifest, TrackCheckpoint};
use crate::{artifacts::digest, store::Store};
use anyhow::{ensure, Result};
use std::path::{Path, PathBuf};
impl CaptureManifest {
    pub fn track_id(&self, index: usize) -> Result<&str> {
        let expected: &[(&str, &str)] = match self.version {
            1 => &[("mic.wav", "mic"), ("output.wav", "output")],
            2 => &[("imported.wav", "imported")],
            _ => anyhow::bail!("unsupported source manifest version"),
        };
        ensure!(
            self.tracks.len() == expected.len(),
            "source track count mismatch"
        );
        ensure!(
            self.sample_rate == 48000 && self.channels == 1,
            "expected mono 48 kHz PCM WAV"
        );
        let (file, id) = expected
            .get(index)
            .ok_or_else(|| anyhow::anyhow!("invalid track"))?;
        ensure!(
            self.tracks[index].file == *file,
            "invalid source track path"
        );
        Ok(id)
    }
    pub fn verified_tracks(&self, root: &Path) -> Result<Vec<PathBuf>> {
        uuid::Uuid::parse_str(&self.meeting)?;
        ensure!(
            matches!(self.state.as_str(), "finished" | "interrupted"),
            "raw source is not closed"
        );
        let root = root.canonicalize()?;
        let directory = root.join("raw").join(&self.meeting);
        ensure!(
            directory.canonicalize()? == directory,
            "raw directory escapes owned storage"
        );
        ensure!(
            !directory
                .join("manifest.json")
                .symlink_metadata()?
                .file_type()
                .is_symlink(),
            "manifest symlink rejected"
        );
        self.track_id(0)?;
        let mut paths = Vec::new();
        for (i, track) in self.tracks.iter().enumerate() {
            self.track_id(i)?;
            let path = directory.join(&track.file);
            ensure!(
                !path.symlink_metadata()?.file_type().is_symlink() && path.canonicalize()? == path,
                "raw track symlink rejected"
            );
            let (hash, bytes) = digest(&path)?;
            ensure!(
                track.sha256.as_deref() == Some(hash.as_str())
                    && (self.version == 2 || bytes == crate::artifacts::raw_bytes(track.frames)?),
                "raw checksum or length mismatch"
            );
            let wav = hound::WavReader::open(&path)?;
            let spec = wav.spec();
            ensure!(
                spec.channels == 1
                    && spec.sample_rate == 48000
                    && spec.bits_per_sample == 16
                    && spec.sample_format == hound::SampleFormat::Int
                    && wav.duration() as u64 == track.frames,
                "raw WAV metadata mismatch"
            );
            let mut samples = 0u64;
            for sample in wav.into_samples::<i16>() {
                sample?;
                samples += 1;
            }
            ensure!(samples == track.frames, "incomplete WAV sample payload");
            paths.push(path);
        }
        Ok(paths)
    }
}
impl Store {
    /// Input is never modified. Only the newly allocated incomplete meeting is cleaned up.
    pub fn import_audio(&self, title: &str, source: &Path) -> Result<String> {
        ensure!(
            !title.trim().is_empty() && title.len() <= 500,
            "title required (maximum 500 bytes)"
        );
        let active: i64 = self.db.query_row(
            "SELECT count(*) FROM meeting WHERE capture_state='recording'",
            [],
            |r| r.get(0),
        )?;
        ensure!(active == 0, "finish capture before importing audio");
        ensure!(source.is_file(), "select a local PCM WAV file");
        ensure!(
            source.metadata()?.len() <= 48000 * 7200 * 2 + 16 * 1024 * 1024,
            "WAV file exceeds the two-hour PCM input size limit"
        );
        let wav = hound::WavReader::open(source)?;
        let spec = wav.spec();
        ensure!(
            spec.channels == 1
                && spec.sample_rate == 48000
                && spec.bits_per_sample == 16
                && spec.sample_format == hound::SampleFormat::Int,
            "supported input: mono 48 kHz 16-bit PCM WAV; convert the file locally first"
        );
        let frames = wav.duration() as u64;
        ensure!(
            frames > 0 && frames <= 48000 * 7200,
            "audio must be nonempty and at most two hours"
        );
        let before = digest(source)?;
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(self.root.join("raw"))?;
        let directory = self.root.join("raw").join(&id);
        std::fs::create_dir(&directory)?;
        let result = (|| -> Result<()> {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            }
            std::fs::copy(source, directory.join("imported.wav"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(
                    directory.join("imported.wav"),
                    std::fs::Permissions::from_mode(0o600),
                )?;
            }
            ensure!(
                digest(source)? == before && digest(&directory.join("imported.wav"))? == before,
                "source changed during import"
            );
            let manifest = CaptureManifest {
                version: 2,
                meeting: id.clone(),
                state: "finished".into(),
                sample_rate: 48000,
                channels: 1,
                clock: "import: original PCM samples; no capture clock".into(),
                alignment: "single imported source; no cross-track alignment".into(),
                tracks: vec![TrackCheckpoint {
                    source: "explicit local file import".into(),
                    file: "imported.wav".into(),
                    frames,
                    first_arrival_ns: None,
                    last_arrival_ns: None,
                    sha256: Some(before.0.clone()),
                }],
            };
            std::fs::write(
                directory.join("manifest.json"),
                serde_json::to_vec_pretty(&manifest)?,
            )?;
            manifest.verified_tracks(&self.root)?;
            std::fs::OpenOptions::new()
                .write(true)
                .open(directory.join("imported.wav"))?
                .sync_all()?;
            std::fs::OpenOptions::new()
                .write(true)
                .open(directory.join("manifest.json"))?
                .sync_all()?;
            #[cfg(unix)]
            std::fs::File::open(&directory)?.sync_all()?;
            let tx = self.db.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO meeting(id,title,capture_state) VALUES(?1,?2,'finished')",
                rusqlite::params![id, title.trim()],
            )?;
            crate::store::session::insert_recording_session(&tx, &id)?;
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            std::fs::remove_dir_all(&directory)?;
            return Err(error);
        }
        Ok(id)
    }
}

/// Recovery may write headers/journal, so authorize every path before any write.
pub(super) fn recovery_directory(root: &Path, meeting: &str) -> Result<PathBuf> {
    let directory = root.canonicalize()?.join("raw").join(meeting);
    ensure!(
        directory.canonicalize()? == directory,
        "recovery directory escapes owned storage"
    );
    for file in [
        "manifest.json",
        "mic.wav",
        "output.wav",
        "timing.jsonl",
        "manifest.pending",
    ] {
        let path = directory.join(file);
        match path.symlink_metadata() {
            Ok(metadata) => ensure!(
                !metadata.file_type().is_symlink() && path.canonicalize()? == path,
                "recovery source symlink rejected"
            ),
            Err(error)
                if file == "manifest.pending" && error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(directory)
}
