//! Window planning and token-time stitching. Frames are 48 kHz raw-track frames.
use super::{dsp::FACTOR, AsrWord};

pub(crate) const FRAMES_PER_MS: u64 = 48;
/// Decoded window, left context included.
pub(crate) const WINDOW: u64 = 10 * 48_000;
pub(crate) const MAX_WINDOW: u64 = 20 * 48_000;
pub(crate) const CONTEXT: u64 = 1_500 * FRAMES_PER_MS;
/// Words ending in the last 0.5 s are decoded again by the next window.
pub(crate) const MARGIN: u64 = 500 * FRAMES_PER_MS;
/// Above this backlog, windows grow linearly up to `MAX_WINDOW` at 60 s.
pub(crate) const BACKLOG_GROW: u64 = 30 * 48_000;
/// A word straddling the commit limit may hold the cursor back, but never by
/// so much that the next window would decode almost the same audio.
const MIN_ADVANCE: u64 = 48_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Window {
    /// Decode start, left context included; a multiple of 3.
    pub start: u64,
    /// First frame not yet committed.
    pub cursor: u64,
    pub end: u64,
    /// Words must end at or before this frame; `None` commits everything
    /// because no later audio can follow (End or a pause boundary).
    pub commit_limit: Option<u64>,
}

/// Plans the next window of one track, or `None` when it must wait for more
/// committed audio. `floor..ceil` is the pause-free span around `cursor`.
pub(crate) fn plan(
    cursor: u64,
    committed: u64,
    floor: u64,
    ceil: Option<u64>,
    ended: bool,
) -> Option<Window> {
    let limit = ceil.map_or(committed, |c| c.min(committed));
    if cursor >= limit {
        return None;
    }
    let hard = ended || ceil.is_some_and(|c| c <= committed);
    let backlog = committed - cursor;
    let total = if backlog > BACKLOG_GROW {
        (backlog / 3).clamp(WINDOW, MAX_WINDOW)
    } else {
        WINDOW
    };
    // Rounding down may reach up to two frames below `floor`; those read as silence.
    let start = cursor.saturating_sub(CONTEXT).max(floor) / FACTOR * FACTOR;
    let end = cursor + (total - (cursor - start));
    if end < limit {
        return Some(Window {
            start,
            cursor,
            end,
            commit_limit: Some(end - MARGIN),
        });
    }
    hard.then_some(Window {
        start,
        cursor,
        end: limit,
        commit_limit: None,
    })
}

/// Words of one window converted to absolute frames.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Commit {
    pub words: Vec<(u64, u64, String)>,
    /// Cursor for the next window of this track.
    pub next: u64,
}

/// A word belongs to the first window whose uncommitted region holds its
/// midpoint, so re-decoded context never repeats a committed word and a word
/// held back by the margin is decoded again in full.
pub(crate) fn commit(window: &Window, words: &[AsrWord]) -> Commit {
    let at = |ms: u32| (window.start + ms as u64 * FRAMES_PER_MS).min(window.end);
    let fresh = words
        .iter()
        .filter(|w| !w.text.trim().is_empty())
        .map(|w| (at(w.t0_ms), at(w.t1_ms.max(w.t0_ms)), w.text.trim()))
        .filter(|(t0, t1, _)| t0 + t1 >= 2 * window.cursor);
    let Some(limit) = window.commit_limit else {
        return Commit {
            words: fresh.map(|(a, b, t)| (a, b, t.to_owned())).collect(),
            next: window.end,
        };
    };
    let mut committed = Vec::new();
    let mut held = None;
    for (t0, t1, text) in fresh {
        if t1 <= limit && held.is_none() {
            committed.push((t0, t1, text.to_owned()));
        } else {
            held.get_or_insert(t0);
        }
    }
    let last_end = committed.last().map_or(window.cursor, |w| w.1);
    let mut next = held.unwrap_or(limit).min(limit).max(last_end);
    if next < window.cursor + MIN_ADVANCE {
        next = limit;
    }
    Commit {
        words: committed,
        next,
    }
}
