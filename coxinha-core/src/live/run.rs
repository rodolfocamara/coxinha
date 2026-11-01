//! Drains one meeting: fresh checkpoint snapshot per window, both tracks.
use super::{
    dsp,
    plan::{self, FRAMES_PER_MS},
    timing::Timing,
    transcript::TranscriptWriter,
    worker::Inner,
    Asr, LiveSegment,
};
use crate::capture::{CommittedTrack, Track};
use anyhow::Result;

const TRACKS: [Track; 2] = [Track::Mic, Track::Output];

/// Returns when the meeting has ended and every committed frame is
/// transcribed, or early on cancel or `forget`. Errors fail only this meeting.
pub(crate) fn drain(inner: &Inner, meeting: &str, asr: &mut dyn Asr) -> Result<()> {
    let root = &inner.root;
    let journal = root.join("raw").join(meeting).join("timing.jsonl");
    let mut writer: Option<TranscriptWriter> = None;
    let mut cursors = [0u64; 2];
    let mut timing = Timing::default();
    loop {
        let ended = {
            let mut s = inner.lock();
            if s.cancelled || s.abandon {
                return Ok(());
            }
            s.wake = false;
            if s.paused {
                s.state = "paused";
                drop(inner.wait(s, inner.tuning.recheck));
                continue;
            }
            s.ended.contains_key(meeting)
        };
        // The End message follows the final checkpoint, so `ended` is read first.
        let mut tracks = [
            CommittedTrack::open(root, meeting, TRACKS[0])?,
            CommittedTrack::open(root, meeting, TRACKS[1])?,
        ];
        let committed = tracks.each_ref().map(CommittedTrack::frames);
        let writer = match &mut writer {
            Some(writer) => writer,
            None => {
                let (opened, resume) = TranscriptWriter::open(root, meeting)?;
                cursors = resume;
                writer.insert(opened)
            }
        };
        timing.update(&journal)?;
        let next = (0..2)
            .filter_map(|i| {
                let (floor, ceil) = timing.span(TRACKS[i], cursors[i]);
                plan::plan(cursors[i], committed[i], floor, ceil, ended)
                    .map(|w| (i, w, floor, ceil))
            })
            .min_by_key(|(_, w, ..)| w.cursor);
        {
            let mut s = inner.lock();
            s.behind_ms = (0..2)
                .map(|i| committed[i].saturating_sub(cursors[i]))
                .max()
                .unwrap_or(0)
                / FRAMES_PER_MS;
            match next {
                Some(_) => s.state = if ended { "draining" } else { "running" },
                None if ended => return Ok(()),
                None => {
                    s.state = "running";
                    drop(inner.wait(s, inner.tuning.recheck));
                    continue;
                }
            }
        }
        let Some((i, window, floor, ceil)) = next else {
            continue;
        };
        let read_start = window.start.saturating_sub(dsp::HALF).max(floor);
        let read_end = (window.end + dsp::HALF)
            .min(ceil.unwrap_or(u64::MAX))
            .min(committed[i]);
        let pcm = tracks[i].read_frames(read_start, read_end)?;
        let new = &pcm[(window.cursor - read_start) as usize..(window.end - read_start) as usize];
        if !dsp::has_voice(new) {
            cursors[i] = window.commit_limit.unwrap_or(window.end);
            continue;
        }
        let input = dsp::decimate(&pcm, read_start, window.start, window.end);
        let commit = plan::commit(&window, &asr.transcribe(&input)?);
        if let (Some(first), Some(last)) = (commit.words.first(), commit.words.last()) {
            if inner.lock().abandon {
                return Ok(());
            }
            let ms = |frame: u64| (frame + timing.paused_before(TRACKS[i], frame)) / FRAMES_PER_MS;
            writer.append(&LiveSegment {
                track: TRACKS[i],
                start_frame: window.cursor,
                end_frame: commit.next,
                start_ms: ms(first.0),
                end_ms: ms(last.1),
                text: commit
                    .words
                    .iter()
                    .map(|w| w.2.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
            })?;
        }
        cursors[i] = commit.next;
    }
}
