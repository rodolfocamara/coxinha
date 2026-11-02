//! Spec 0099: the live Tagarela transcript replaces Whisper in processing.
//! Words become segments that never cross a pause or a speaker turn, so the
//! overlap attribution sees one speaker per segment.
use crate::capture::Track;
use crate::live::LiveSegment;
use crate::processing::{SpeakerTurn, TranscriptSegment};

const PAUSE_MS: u64 = 800;
const MAX_MS: u64 = 15_000;

pub(super) fn track_name(track: Track) -> &'static str {
    match track {
        Track::Mic => "mic",
        Track::Output => "output",
    }
}

fn speaker_at<'a>(turns: &'a [&SpeakerTurn], ms: u64) -> Option<&'a str> {
    turns
        .iter()
        .find(|t| t.start_ms <= ms && ms < t.end_ms)
        .map(|t| t.speaker.as_str())
}

fn push(out: &mut Vec<TranscriptSegment>, track: &str, words: &[(u64, u64, &str)]) {
    let (Some(first), Some(last)) = (words.first(), words.last()) else {
        return;
    };
    if last.1 <= first.0 {
        return;
    }
    out.push(TranscriptSegment {
        id: uuid::Uuid::new_v4().to_string(),
        track: track.into(),
        start_ms: first.0,
        end_ms: last.1,
        text: words.iter().map(|w| w.2).collect::<Vec<_>>().join(" "),
        speaker: None,
    });
}

/// Segments of one track. Lines written before word timings existed fall back
/// to one segment per line on the raw clock, and the caller warns.
pub(super) fn segments(
    track: &str,
    lines: &[LiveSegment],
    turns: &[SpeakerTurn],
) -> (Vec<TranscriptSegment>, bool) {
    let lines: Vec<_> = lines
        .iter()
        .filter(|l| track_name(l.track) == track && !l.text.trim().is_empty())
        .collect();
    let turns: Vec<_> = turns.iter().filter(|t| t.track == track).collect();
    let mut out = Vec::new();
    let mut legacy = false;
    let mut current: Vec<(u64, u64, &str)> = Vec::new();
    let mut speaker: Option<&str> = None;
    for line in lines {
        if line.words.is_empty() {
            legacy = true;
            push(&mut out, track, &current);
            current.clear();
            let (start, end) = (line.start_frame / 48, line.end_frame / 48);
            push(&mut out, track, &[(start, end, line.text.trim())]);
            continue;
        }
        for word in &line.words {
            let here = speaker_at(&turns, (word.start_ms + word.end_ms) / 2);
            let split = current.first().is_some_and(|first| {
                let last = current.last().map_or(first.1, |w| w.1);
                word.start_ms.saturating_sub(last) > PAUSE_MS
                    || here != speaker
                    || word.end_ms.saturating_sub(first.0) > MAX_MS
            });
            if split {
                push(&mut out, track, &current);
                current.clear();
            }
            if current.is_empty() {
                speaker = here;
            }
            current.push((
                word.start_ms,
                word.end_ms.max(word.start_ms),
                word.text.trim(),
            ));
        }
    }
    push(&mut out, track, &current);
    (out, legacy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::LiveWord;

    fn line(words: &[(u64, u64, &str)]) -> LiveSegment {
        LiveSegment {
            track: Track::Output,
            start_frame: words[0].0 * 48,
            end_frame: words[words.len() - 1].1 * 48,
            start_ms: words[0].0,
            end_ms: words[words.len() - 1].1,
            text: words.iter().map(|w| w.2).collect::<Vec<_>>().join(" "),
            words: words
                .iter()
                .map(|(a, b, t)| LiveWord {
                    start_ms: *a,
                    end_ms: *b,
                    text: (*t).into(),
                })
                .collect(),
        }
    }
    fn turn(speaker: &str, start_ms: u64, end_ms: u64) -> SpeakerTurn {
        SpeakerTurn {
            id: speaker.into(),
            track: "output".into(),
            start_ms,
            end_ms,
            speaker: speaker.into(),
            embedding: None,
            space: None,
        }
    }

    #[test]
    fn splits_at_speaker_turns_and_pauses_and_ignores_the_other_track() {
        let lines = [line(&[
            (0, 300, "bom"),
            (350, 700, "dia"),
            (750, 1_000, "pessoal"),
            (1_100, 1_400, "oi"),
            (3_000, 3_300, "então"),
        ])];
        let turns = [turn("a", 0, 1_050), turn("b", 1_050, 5_000)];
        let (out, legacy) = segments("output", &lines, &turns);
        assert!(!legacy);
        let texts: Vec<_> = out
            .iter()
            .map(|s| (s.text.as_str(), s.start_ms, s.end_ms))
            .collect();
        assert_eq!(
            texts,
            [
                ("bom dia pessoal", 0, 1_000),
                ("oi", 1_100, 1_400),
                ("então", 3_000, 3_300)
            ]
        );
        assert!(segments("mic", &lines, &turns).0.is_empty());
    }

    #[test]
    fn lines_without_words_fall_back_to_one_segment_on_the_raw_clock() {
        let mut old = line(&[(1_000, 2_000, "antigo")]);
        old.words.clear();
        old.start_ms = 9_999; // capture clock with pauses: never used here
        let (out, legacy) = segments("output", &[old], &[]);
        assert!(legacy);
        assert_eq!(
            (out[0].start_ms, out[0].end_ms, out[0].text.as_str()),
            (1_000, 2_000, "antigo")
        );
    }
}
