//! Spec 0099: the live Tagarela transcript replaces Whisper in processing.
//! Spec 0101: each word takes the labelled turn under it; words under no
//! label (short or overlapped speech) stay in the running segment. Segments
//! never cross a pause or a change of labelled speaker.
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

/// A word: start, end, text, labelled speaker.
type Word<'a> = (u64, u64, &'a str, Option<&'a str>);

/// The segment's speaker when labelled words cover at least half its words.
fn push(out: &mut Vec<TranscriptSegment>, track: &str, words: &[Word]) {
    let (Some(first), Some(last)) = (words.first(), words.last()) else {
        return;
    };
    if last.1 <= first.0 {
        return;
    }
    let length = |w: &Word| w.1.saturating_sub(w.0).max(1);
    let total: u64 = words.iter().map(length).sum();
    let labelled = words.iter().find_map(|w| w.3);
    let covered: u64 = words.iter().filter(|w| w.3.is_some()).map(length).sum();
    out.push(TranscriptSegment {
        id: uuid::Uuid::new_v4().to_string(),
        track: track.into(),
        start_ms: first.0,
        end_ms: last.1,
        text: words.iter().map(|w| w.2).collect::<Vec<_>>().join(" "),
        speaker: labelled.filter(|_| covered * 2 >= total).map(str::to_owned),
    });
}

/// Attributed segments of one track. Lines written before word timings
/// existed become one segment each on the raw clock, attributed by the
/// general overlap rule; the caller warns.
pub(super) fn segments(
    track: &str,
    lines: &[LiveSegment],
    turns: &[SpeakerTurn],
) -> (Vec<TranscriptSegment>, bool) {
    let lines: Vec<_> = lines
        .iter()
        .filter(|l| track_name(l.track) == track && !l.text.trim().is_empty())
        .collect();
    let track_turns: Vec<SpeakerTurn> =
        turns.iter().filter(|t| t.track == track).cloned().collect();
    let labelled: Vec<_> = track_turns
        .iter()
        .filter(|t| t.speaker != "unknown")
        .collect();
    let mut out = Vec::new();
    let mut old = Vec::new();
    let mut current: Vec<Word> = Vec::new();
    let mut speaker: Option<&str> = None;
    for line in lines {
        if line.words.is_empty() {
            let (start, end) = (line.start_frame / 48, line.end_frame / 48);
            push(&mut old, track, &[(start, end, line.text.trim(), None)]);
            continue;
        }
        for word in &line.words {
            let here = speaker_at(&labelled, (word.start_ms + word.end_ms) / 2);
            let split = current.first().is_some_and(|first| {
                let last = current.last().map_or(first.1, |w| w.1);
                word.start_ms.saturating_sub(last) > PAUSE_MS
                    || (here.is_some() && speaker.is_some() && here != speaker)
                    || word.end_ms.saturating_sub(first.0) > MAX_MS
            });
            if split {
                push(&mut out, track, &current);
                current.clear();
                speaker = None;
            }
            speaker = speaker.or(here);
            current.push((
                word.start_ms,
                word.end_ms.max(word.start_ms),
                word.text.trim(),
                here,
            ));
        }
    }
    push(&mut out, track, &current);
    let legacy = !old.is_empty();
    crate::processing::attribute_segments(&mut old, &track_turns);
    out.extend(old);
    out.sort_by_key(|s| s.start_ms);
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
            .map(|s| (s.text.as_str(), s.start_ms, s.end_ms, s.speaker.as_deref()))
            .collect();
        assert_eq!(
            texts,
            [
                ("bom dia pessoal", 0, 1_000, Some("a")),
                ("oi", 1_100, 1_400, Some("b")),
                ("então", 3_000, 3_300, Some("b"))
            ]
        );
        assert!(segments("mic", &lines, &turns).0.is_empty());
    }

    #[test]
    fn a_short_unknown_turn_neither_splits_nor_unlabels_the_speech_around_it() {
        let lines = [line(&[
            (0, 400, "então"),
            (450, 700, "a"),
            (750, 1_200, "gente"),
            (1_250, 1_600, "fechou"),
        ])];
        let turns = [
            turn("a", 0, 500),
            turn("unknown", 500, 1_700),
            turn("a", 1_700, 2_000),
        ];
        let (out, _) = segments("output", &lines, &turns);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "então a gente fechou");
        // Only "então" (400 of 1_450 ms of words) is labelled: under half.
        assert_eq!(out[0].speaker, None);
        let shorter = [
            turn("a", 0, 500),
            turn("unknown", 500, 900),
            turn("a", 900, 2_000),
        ];
        assert_eq!(
            segments("output", &lines, &shorter).0[0].speaker.as_deref(),
            Some("a")
        );
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
