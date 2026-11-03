//! Microphone level of each speaker cluster, so the naming screen can fold
//! room bleed (spec 0120 P5). Bounded reads: at most 24 windows of 2 s each.
use super::*;
use crate::capture::{CommittedTrack, Track};
use crate::store::Store;

pub const LEVEL_TURNS: usize = 24;
const HALF_WINDOW_MS: u64 = 1000;
const FLOOR_DB: f64 = -120.0;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerLevel {
    pub track: String,
    pub speaker: String,
    pub level_db: f64,
}

/// Centre windows (ms) of up to `LEVEL_TURNS` turns spread over the meeting.
pub fn level_windows(turns: &[(u64, u64)]) -> Vec<(u64, u64)> {
    let mut sorted = turns.to_vec();
    sorted.sort();
    let n = sorted.len();
    let picked: Vec<_> = if n > LEVEL_TURNS {
        (0..LEVEL_TURNS)
            .map(|i| sorted[i * n / LEVEL_TURNS])
            .collect()
    } else {
        sorted
    };
    picked
        .into_iter()
        .filter(|(start, end)| end > start)
        .map(|(start, end)| {
            let middle = start + (end - start) / 2;
            let half = HALF_WINDOW_MS.min((end - start) / 2).max(1);
            (middle.saturating_sub(half), middle + half)
        })
        .collect()
}
pub fn rms_db(samples: &[i16]) -> f64 {
    if samples.is_empty() {
        return FLOOR_DB;
    }
    let power = samples.iter().map(|s| (*s as f64).powi(2)).sum::<f64>()
        / samples.len() as f64
        / (32768f64 * 32768f64);
    if power > 0.0 {
        (10.0 * power.log10()).max(FLOOR_DB)
    } else {
        FLOOR_DB
    }
}
pub fn median(mut values: Vec<f64>) -> Option<f64> {
    values.sort_by(f64::total_cmp);
    let n = values.len();
    match n {
        0 => None,
        _ if n % 2 == 1 => Some(values[n / 2]),
        _ => Some((values[n / 2 - 1] + values[n / 2]) / 2.0),
    }
}

impl Store {
    /// Median level of each named microphone cluster of a job; empty when the
    /// recording has no microphone track (imports).
    pub fn speaker_levels(&self, job: &str) -> Result<Vec<SpeakerLevel>> {
        let report = self.processing_report_by_job(job)?;
        let meeting: String =
            self.db
                .query_row("SELECT meeting_id FROM job WHERE id=?1", [job], |r| {
                    r.get(0)
                })?;
        let Ok(mut track) = CommittedTrack::open(&self.root, &meeting, Track::Mic) else {
            return Ok(vec![]);
        };
        let mut turns: BTreeMap<&str, Vec<(u64, u64)>> = BTreeMap::new();
        for turn in report.turns.iter().filter(|t| t.track == "mic") {
            if turn.speaker != "unknown" && !turn.speaker.trim().is_empty() {
                turns
                    .entry(&turn.speaker)
                    .or_default()
                    .push((turn.start_ms, turn.end_ms));
            }
        }
        let mut levels = Vec::new();
        for (speaker, spans) in turns {
            let mut values = Vec::new();
            for (start, end) in level_windows(&spans) {
                let frames = (start * 48, (end * 48).min(track.frames()));
                if frames.1 <= frames.0 {
                    continue;
                }
                values.push(rms_db(&track.read_frames(frames.0, frames.1)?));
            }
            if let Some(level_db) = median(values) {
                levels.push(SpeakerLevel {
                    track: "mic".into(),
                    speaker: speaker.to_owned(),
                    level_db,
                });
            }
        }
        Ok(levels)
    }
}

#[cfg(test)]
#[path = "levels_tests.rs"]
mod tests;
