//! `outputs/live/transcript.jsonl`: append-only, one fsync per window, no cursor file.
use super::LiveSegment;
use anyhow::{ensure, Result};
use std::{
    collections::HashSet,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

fn live_directory(root: &Path, meeting: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(meeting)?;
    Ok(root.join("raw").join(meeting).join("outputs").join("live"))
}

/// Complete lines only; a later duplicate of `(track, start_frame)` is ignored.
fn parse(bytes: &[u8]) -> (Vec<LiveSegment>, usize) {
    let complete = bytes.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    let mut seen = HashSet::new();
    let segments = bytes[..complete]
        .split(|b| *b == b'\n')
        .filter_map(|line| serde_json::from_slice::<LiveSegment>(line).ok())
        .filter(|s| seen.insert((s.track, s.start_frame)))
        .collect();
    (segments, complete)
}

/// Reads the live transcript, dropping a trailing partial line and duplicate
/// windows, ordered by `start_ms` and then track. A missing file is empty.
pub fn read_transcript(root: &Path, meeting: &str) -> Result<Vec<LiveSegment>> {
    let path = live_directory(root, meeting)?.join("transcript.jsonl");
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut segments = parse(&bytes).0;
    segments.sort_by_key(|s| (s.start_ms, s.track));
    Ok(segments)
}

pub(crate) struct TranscriptWriter {
    file: File,
}

impl TranscriptWriter {
    /// Opens for append after cutting a partial line left by a crash, and
    /// returns the resume cursor of each track (largest `end_frame`).
    pub fn open(root: &Path, meeting: &str) -> Result<(Self, [u64; 2])> {
        let raw = root.join("raw").join(meeting);
        ensure!(
            raw.symlink_metadata()?.is_dir(),
            "capture directory missing"
        );
        let directory = live_directory(root, meeting)?;
        std::fs::create_dir_all(&directory)?;
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join("transcript.jsonl"))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        let (segments, complete) = parse(&bytes);
        if complete < bytes.len() {
            file.set_len(complete as u64)?;
            file.sync_data()?;
        }
        file.seek(SeekFrom::End(0))?;
        let mut cursors = [0; 2];
        for s in segments {
            let i = super::timing::index(s.track);
            cursors[i] = cursors[i].max(s.end_frame);
        }
        Ok((Self { file }, cursors))
    }

    pub fn append(&mut self, segment: &LiveSegment) -> Result<()> {
        let mut line = serde_json::to_vec(segment)?;
        line.push(b'\n');
        self.file.write_all(&line)?;
        self.file.sync_data()?;
        Ok(())
    }
}
