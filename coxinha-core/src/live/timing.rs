//! Incremental reader of the recorder's `timing.jsonl` for pause boundaries.
//!
//! Paused blocks are journalled as `paused_frames` and never reach the WAV, so a
//! pause or resume is a discontinuity at the track's current frame count.
use crate::capture::Track;
use anyhow::Result;
use serde::Deserialize;
use std::{
    fs::File,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::Path,
};

#[derive(Deserialize)]
struct Event {
    kind: String,
    track: Option<Track>,
    start_frame: Option<u64>,
    frames: Option<u64>,
}

#[derive(Default)]
pub(crate) struct Timing {
    offset: u64,
    written: [u64; 2],
    boundaries: [Vec<u64>; 2],
    /// `(frame, paused frames before it)`, cumulative and increasing.
    paused: [Vec<(u64, u64)>; 2],
}

pub(crate) fn index(track: Track) -> usize {
    match track {
        Track::Mic => 0,
        Track::Output => 1,
    }
}

impl Timing {
    /// Consumes complete lines appended since the last call; a trailing partial
    /// line is left for the next one. A missing journal has no events yet.
    pub fn update(&mut self, path: &Path) -> Result<()> {
        let mut file = match File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        file.seek(SeekFrom::Start(self.offset))?;
        let mut reader = BufReader::new(file);
        let mut line = Vec::new();
        loop {
            line.clear();
            let read = reader.read_until(b'\n', &mut line)?;
            if read == 0 || line.last() != Some(&b'\n') {
                return Ok(());
            }
            self.offset += read as u64;
            if let Ok(event) = serde_json::from_slice::<Event>(&line) {
                self.apply(event);
            }
        }
    }

    fn apply(&mut self, event: Event) {
        match (event.kind.as_str(), event.track) {
            ("block", Some(track)) => {
                if let (Some(start), Some(frames)) = (event.start_frame, event.frames) {
                    self.written[index(track)] = start + frames;
                }
            }
            ("pause" | "resume", _) => {
                for i in 0..2 {
                    let at = self.written[i];
                    if at > 0 && self.boundaries[i].last() != Some(&at) {
                        self.boundaries[i].push(at);
                    }
                }
            }
            ("paused_frames", Some(track)) => {
                let i = index(track);
                let at = self.written[i];
                let frames = event.frames.unwrap_or(0);
                match self.paused[i].last_mut() {
                    Some((frame, total)) if *frame == at => *total += frames,
                    last => {
                        let total = last.map_or(0, |l| l.1) + frames;
                        self.paused[i].push((at, total));
                    }
                }
            }
            _ => {}
        }
    }

    /// The pause-free span `floor..ceil` holding `cursor`.
    pub fn span(&self, track: Track, cursor: u64) -> (u64, Option<u64>) {
        let b = &self.boundaries[index(track)];
        let split = b.partition_point(|x| *x <= cursor);
        (
            split.checked_sub(1).map_or(0, |i| b[i]),
            b.get(split).copied(),
        )
    }

    /// Paused frames that precede raw frame `frame` on the capture clock.
    pub fn paused_before(&self, track: Track, frame: u64) -> u64 {
        let p = &self.paused[index(track)];
        let split = p.partition_point(|x| x.0 <= frame);
        split.checked_sub(1).map_or(0, |i| p[i].1)
    }
}
