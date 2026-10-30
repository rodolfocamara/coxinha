use crate::{artifacts::digest, store::Store};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::PathBuf,
};

pub const RATE: u32 = 48000;
pub const MAX_SAMPLES: usize = 4096;
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum Track {
    Mic,
    Output,
}
impl Track {
    fn index(self) -> usize {
        match self {
            Self::Mic => 0,
            Self::Output => 1,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrackCheckpoint {
    pub source: String,
    pub file: String,
    pub frames: u64,
    pub first_arrival_ns: Option<u64>,
    pub last_arrival_ns: Option<u64>,
    pub sha256: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CaptureManifest {
    pub version: u32,
    pub meeting: String,
    pub state: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub clock: String,
    pub alignment: String,
    pub tracks: Vec<TrackCheckpoint>,
}
pub struct Recording {
    directory: PathBuf,
    tracks: [File; 2],
    journal: File,
    pub(crate) manifest: CaptureManifest,
    paused: bool,
    closed: bool,
    last_timestamp: [Option<u64>; 2],
    checkpoint_job: Option<std::thread::JoinHandle<Result<()>>>,
}
fn write_header(file: &mut File, frames: u64) -> Result<()> {
    let bytes = u32::try_from(
        frames
            .checked_mul(2)
            .ok_or_else(|| anyhow::anyhow!("WAV size overflow"))?,
    )?;
    ensure!(bytes <= u32::MAX - 36, "WAV requires rollover before 4 GiB");
    file.seek(SeekFrom::Start(0))?;
    file.write_all(b"RIFF")?;
    file.write_all(&(bytes + 36).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&RATE.to_le_bytes())?;
    file.write_all(&(RATE * 2).to_le_bytes())?;
    file.write_all(&2u16.to_le_bytes())?;
    file.write_all(&16u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&bytes.to_le_bytes())?;
    file.seek(SeekFrom::End(0))?;
    Ok(())
}
fn save_manifest(directory: &std::path::Path, manifest: &CaptureManifest) -> Result<()> {
    let path = directory.join("manifest.pending");
    let mut f = File::create(&path)?;
    f.write_all(&serde_json::to_vec_pretty(manifest)?)?;
    f.sync_all()?;
    std::fs::rename(path, directory.join("manifest.json"))?;
    #[cfg(unix)]
    File::open(directory)?.sync_all()?;
    Ok(())
}
impl Recording {
    pub fn start(store: &Store, meeting: &str, mic: &str, output: &str) -> Result<Self> {
        ensure!(
            !mic.is_empty() && !output.is_empty() && mic != output,
            "two distinct explicit sources required"
        );
        let running: i64 = store.db.query_row(
            "SELECT count(*) FROM job WHERE state='running' AND stage='local-processing'",
            [],
            |r| r.get(0),
        )?;
        ensure!(running == 0, "busy: local processing active");
        uuid::Uuid::parse_str(meeting)?;
        ensure!(
            store.db.execute(
                "UPDATE meeting SET capture_state='recording' WHERE id=?1 AND capture_state='new'",
                [meeting]
            )? == 1,
            "meeting already captured or not found"
        );
        let result = (|| {
            let directory = store.root.join("raw").join(meeting);
            std::fs::create_dir_all(&directory)?;
            let mut tracks = [
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(directory.join("mic.wav"))?,
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(directory.join("output.wav"))?,
            ];
            for f in &mut tracks {
                write_header(f, 0)?;
                f.sync_all()?;
            }
            let journal = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(directory.join("timing.jsonl"))?;
            let manifest = CaptureManifest {
                version: 1,
                meeting: meeting.into(),
                state: "recording".into(),
                sample_rate: RATE,
                channels: 1,
                clock: "monotonic arrival at reader; hardware timestamps unavailable".into(),
                alignment: "unmeasured device latency and drift; no correction applied".into(),
                tracks: vec![
                    TrackCheckpoint {
                        source: mic.into(),
                        file: "mic.wav".into(),
                        frames: 0,
                        first_arrival_ns: None,
                        last_arrival_ns: None,
                        sha256: None,
                    },
                    TrackCheckpoint {
                        source: output.into(),
                        file: "output.wav".into(),
                        frames: 0,
                        first_arrival_ns: None,
                        last_arrival_ns: None,
                        sha256: None,
                    },
                ],
            };
            save_manifest(&directory, &manifest)?;
            Ok(Self {
                directory,
                tracks,
                journal,
                manifest,
                paused: false,
                closed: false,
                last_timestamp: [None, None],
                checkpoint_job: None,
            })
        })();
        if result.is_err() {
            store.db.execute(
                "UPDATE meeting SET capture_state='interrupted' WHERE id=?1",
                [meeting],
            )?;
        }
        result
    }
    fn event(&mut self, event: serde_json::Value) -> Result<()> {
        serde_json::to_writer(&mut self.journal, &event)?;
        self.journal.write_all(b"\n")?;
        Ok(())
    }
    pub fn write_block(&mut self, track: Track, samples: &[i16], arrival_ns: u64) -> Result<f32> {
        ensure!(!self.closed, "capture is closed");
        ensure!(
            !samples.is_empty() && samples.len() <= MAX_SAMPLES,
            "audio block exceeds bounded capacity"
        );
        let i = track.index();
        ensure!(
            self.last_timestamp[i].is_none_or(|t| arrival_ns >= t),
            "non-monotonic capture timestamp"
        );
        self.last_timestamp[i] = Some(arrival_ns);
        if self.paused {
            self.event(serde_json::json!({"kind":"paused_frames","track":track,"frames":samples.len(),"arrival_ns":arrival_ns}))?;
            return Ok(0.0);
        }
        let start = self.manifest.tracks[i].frames;
        // Refuse a block before crossing the RIFF size limit, never silently wrap.
        ensure!(
            (start + samples.len() as u64) * 2 <= u32::MAX as u64 - 36,
            "WAV capacity reached; finalize capture"
        );
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for s in samples {
            bytes.extend(s.to_le_bytes());
        }
        self.tracks[i].write_all(&bytes)?;
        self.manifest.tracks[i].frames += samples.len() as u64;
        self.manifest.tracks[i]
            .first_arrival_ns
            .get_or_insert(arrival_ns);
        self.manifest.tracks[i].last_arrival_ns = Some(arrival_ns);
        self.event(serde_json::json!({"kind":"block","track":track,"start_frame":start,"frames":samples.len(),"arrival_ns":arrival_ns}))?;
        Ok(samples
            .iter()
            .map(|s| (*s as f32 / 32768.0).abs())
            .fold(0.0, f32::max))
    }
    pub fn pause(&mut self, paused: bool, at_ns: u64) -> Result<()> {
        ensure!(!self.closed, "capture is closed");
        ensure!(
            self.paused != paused,
            "capture already in requested pause state"
        );
        self.paused = paused;
        self.event(
            serde_json::json!({"kind":if paused{"pause"}else{"resume"},"arrival_ns":at_ns}),
        )?;
        self.request_checkpoint()
    }
    pub fn gap(&mut self, reason: &str, at_ns: u64) -> Result<()> {
        ensure!(!self.closed, "capture is closed");
        self.event(serde_json::json!({"kind":"gap","reason":reason,"arrival_ns":at_ns}))?;
        self.checkpoint()
    }
    fn join_checkpoint(&mut self) -> Result<()> {
        if let Some(job) = self.checkpoint_job.take() {
            job.join()
                .map_err(|_| anyhow::anyhow!("capture checkpoint worker panicked"))??;
        }
        Ok(())
    }
    /// At most one durability operation runs alongside capture. Independent file
    /// descriptions keep header seeks from changing the audio writer's offset.
    pub fn request_checkpoint(&mut self) -> Result<()> {
        ensure!(!self.closed, "capture is closed");
        if self
            .checkpoint_job
            .as_ref()
            .is_some_and(|job| !job.is_finished())
        {
            return Ok(());
        }
        self.join_checkpoint()?;
        let directory = self.directory.clone();
        let manifest = self.manifest.clone();
        self.checkpoint_job = Some(
            std::thread::Builder::new()
                .name("capture-checkpoint".into())
                .spawn(move || {
                    for track in &manifest.tracks {
                        let mut file = OpenOptions::new()
                            .write(true)
                            .open(directory.join(&track.file))?;
                        write_header(&mut file, track.frames)?;
                        file.sync_all()?;
                    }
                    File::open(directory.join("timing.jsonl"))?.sync_all()?;
                    save_manifest(&directory, &manifest)
                })?,
        );
        Ok(())
    }
    pub fn checkpoint(&mut self) -> Result<()> {
        self.join_checkpoint()?;
        ensure!(!self.closed, "capture is closed");
        for i in 0..2 {
            write_header(&mut self.tracks[i], self.manifest.tracks[i].frames)?;
            self.tracks[i].sync_all()?;
        }
        self.journal.sync_all()?;
        save_manifest(&self.directory, &self.manifest)
    }
    pub fn finish(&mut self, store: &Store, interrupted: bool) -> Result<CaptureManifest> {
        ensure!(!self.closed, "capture is closed");
        ensure!(
            interrupted || self.manifest.tracks.iter().all(|t| t.frames > 0),
            "both tracks must receive audio"
        );
        self.checkpoint()?;
        for t in &mut self.manifest.tracks {
            t.sha256 = Some(digest(&self.directory.join(&t.file))?.0);
        }
        self.manifest.state = if interrupted {
            "interrupted"
        } else {
            "finished"
        }
        .into();
        save_manifest(&self.directory, &self.manifest)?;
        store.db.execute(
            "UPDATE meeting SET capture_state=?2 WHERE id=?1",
            rusqlite::params![self.manifest.meeting, self.manifest.state],
        )?;
        self.closed = true;
        Ok(self.manifest.clone())
    }
}
impl Drop for Recording {
    fn drop(&mut self) {
        // Recovery must never race a detached checkpoint publishing an older manifest.
        let _ = self.join_checkpoint();
    }
}
impl Store {
    pub fn recover_capture(&self, meeting: &str) -> Result<CaptureManifest> {
        uuid::Uuid::parse_str(meeting)?;
        let directory = super::imported::recovery_directory(&self.root, meeting)?;
        let mut manifest: CaptureManifest =
            serde_json::from_reader(File::open(directory.join("manifest.json"))?)?;
        ensure!(
            manifest.version == 1
                && manifest.meeting == meeting
                && manifest.sample_rate == RATE
                && manifest.channels == 1,
            "unsupported capture manifest"
        );
        manifest.track_id(0)?;
        if manifest.state == "finished"
            || (manifest.state == "interrupted"
                && manifest.tracks.iter().all(|t| t.sha256.is_some()))
        {
            for (i, t) in manifest.tracks.iter().enumerate() {
                ensure!(
                    t.file == if i == 0 { "mic.wav" } else { "output.wav" },
                    "invalid raw track path"
                );
                ensure!(
                    t.sha256.as_deref() == Some(digest(&directory.join(&t.file))?.0.as_str()),
                    "immutable raw checksum mismatch"
                );
            }
            self.db.execute(
                "UPDATE meeting SET capture_state=?2 WHERE id=?1",
                rusqlite::params![meeting, manifest.state],
            )?;
            return Ok(manifest);
        }
        ensure!(
            matches!(manifest.state.as_str(), "recording" | "interrupted"),
            "unsupported capture state"
        );
        for (i, t) in manifest.tracks.iter_mut().enumerate() {
            ensure!(
                t.file == if i == 0 { "mic.wav" } else { "output.wav" },
                "invalid raw track path"
            );
            let path = directory.join(&t.file);
            let mut f = OpenOptions::new().write(true).open(&path)?;
            let len = f.metadata()?.len();
            ensure!(
                len >= 44 && (len - 44) % 2 == 0,
                "invalid/partial PCM frame; manual recovery required"
            );
            t.frames = (len - 44) / 2;
            write_header(&mut f, t.frames)?;
            f.sync_all()?;
            t.sha256 = Some(digest(&path)?.0);
        }
        manifest.state = "interrupted".into();
        let mut journal = OpenOptions::new()
            .append(true)
            .open(directory.join("timing.jsonl"))?;
        writeln!(
            journal,
            "{}",
            serde_json::json!({"kind":"gap","reason":"unclean shutdown; timing of uncheckpointed tail is uncertain"})
        )?;
        journal.sync_all()?;
        save_manifest(&directory, &manifest)?;
        self.db.execute(
            "UPDATE meeting SET capture_state='interrupted' WHERE id=?1",
            [meeting],
        )?;
        Ok(manifest)
    }
}

#[cfg(test)]
#[path = "recording_tests.rs"]
mod tests;
