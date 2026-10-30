//! Read-only snapshots of the version-1 recorder's durable PCM prefix.
use super::{CaptureManifest, Track};
use anyhow::{ensure, Context, Result};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

const HEADER_BYTES: u64 = 44;
const MANIFEST_LIMIT: u64 = 64 * 1024;
pub const MAX_READ_FRAMES: u64 = 30 * 48000 + 96;

pub struct CommittedTrack {
    file: File,
    frames: u64,
}

impl CommittedTrack {
    /// Opening a new snapshot is explicit: appending or checkpointing cannot grow
    /// this reader's range. Imported WAVs have a different, variable header layout.
    pub fn open(root: &Path, meeting: &str, track: Track) -> Result<Self> {
        uuid::Uuid::parse_str(meeting)?;
        let directory = root.canonicalize()?.join("raw").join(meeting);
        ensure!(
            directory.canonicalize()? == directory,
            "raw directory escapes owned storage"
        );
        let manifest_path = directory.join("manifest.json");
        let mut bytes = Vec::new();
        owned_file(&manifest_path)?
            .take(MANIFEST_LIMIT + 1)
            .read_to_end(&mut bytes)?;
        ensure!(
            bytes.len() as u64 <= MANIFEST_LIMIT,
            "capture manifest too large"
        );
        let manifest: CaptureManifest = serde_json::from_slice(&bytes)?;
        ensure!(
            manifest.version == 1
                && manifest.meeting == meeting
                && matches!(
                    manifest.state.as_str(),
                    "recording" | "finished" | "interrupted"
                ),
            "expected version-1 capture checkpoint"
        );
        manifest.track_id(0)?;
        manifest.track_id(1)?;
        let index = match track {
            Track::Mic => 0,
            Track::Output => 1,
        };
        let checkpoint = &manifest.tracks[index];
        let data_bytes = checkpoint
            .frames
            .checked_mul(2)
            .context("PCM size overflow")?;
        ensure!(
            data_bytes <= u32::MAX as u64 - 36,
            "capture exceeds RIFF capacity"
        );
        let file = owned_file(&directory.join(&checkpoint.file))?;
        ensure!(
            file.metadata()?.len() >= HEADER_BYTES + data_bytes,
            "raw track shorter than committed checkpoint"
        );
        Ok(Self {
            file,
            frames: checkpoint.frames,
        })
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }

    /// Sample offsets are on the raw track's 48 kHz clock, not wall-clock time.
    /// External modifications still require source verification before publication.
    pub fn read_frames(&mut self, start: u64, end: u64) -> Result<Vec<i16>> {
        ensure!(
            start <= end && end <= self.frames,
            "range exceeds committed checkpoint"
        );
        let count = end - start;
        ensure!(count <= MAX_READ_FRAMES, "PCM read exceeds bounded window");
        self.file.seek(SeekFrom::Start(HEADER_BYTES + start * 2))?;
        let mut bytes = vec![0; (count * 2) as usize];
        self.file
            .read_exact(&mut bytes)
            .context("committed PCM range was truncated")?;
        Ok(bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect())
    }
}

fn owned_file(path: &Path) -> Result<File> {
    ensure!(
        path.symlink_metadata()?.is_file() && path.canonicalize()? == path,
        "expected owned regular capture file"
    );
    let file = File::open(path)?;
    ensure!(file.metadata()?.is_file(), "expected regular capture file");
    Ok(file)
}

#[cfg(test)]
#[path = "committed_tests.rs"]
mod tests;
