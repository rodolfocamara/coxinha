//! Conservative same-source attribution. Parameters are algorithm rules, not confidence.
use super::{SpeakerTurn, TranscriptSegment};
/// v2: at least 70% union coverage, no competing/unknown speaker at any overlap.
/// Repeated turns are unioned to avoid double-counting duplicate diarization windows.
pub fn attribute_segments(segments: &mut [TranscriptSegment], turns: &[SpeakerTurn]) {
    for segment in segments {
        segment.speaker = None;
        if segment.end_ms <= segment.start_ms {
            continue;
        }
        let relevant: Vec<_> = turns
            .iter()
            .filter(|t| {
                t.track == segment.track
                    && t.start_ms < segment.end_ms
                    && t.end_ms > segment.start_ms
            })
            .collect();
        let Some(first) = relevant.first() else {
            continue;
        };
        if first.speaker == "unknown" || relevant.iter().any(|t| t.speaker != first.speaker) {
            continue;
        }
        let mut intervals: Vec<_> = relevant
            .iter()
            .map(|t| {
                (
                    t.start_ms.max(segment.start_ms),
                    t.end_ms.min(segment.end_ms),
                )
            })
            .collect();
        intervals.sort_unstable();
        let mut covered = 0;
        let mut end = segment.start_ms;
        for (a, b) in intervals {
            covered += b.saturating_sub(a.max(end));
            end = end.max(b);
        }
        if covered as u128 * 100 >= (segment.end_ms - segment.start_ms) as u128 * 70 {
            segment.speaker = Some(first.speaker.clone());
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn turn(a: u64, b: u64, s: &str, track: &str) -> SpeakerTurn {
        SpeakerTurn {
            id: format!("{a}"),
            track: track.into(),
            start_ms: a,
            end_ms: b,
            speaker: s.into(),
            embedding: None,
            space: None,
        }
    }
    #[test]
    fn repeated_turns_union_and_ambiguity_abstains() {
        let mut segments = vec![TranscriptSegment {
            id: "s".into(),
            track: "imported".into(),
            start_ms: 0,
            end_ms: 1000,
            text: "text".into(),
            speaker: None,
        }];
        attribute_segments(
            &mut segments,
            &[
                turn(0, 400, "a", "imported"),
                turn(300, 800, "a", "imported"),
                turn(0, 1000, "b", "mic"),
            ],
        );
        assert_eq!(segments[0].speaker.as_deref(), Some("a"));
        for turns in [
            vec![
                turn(0, 400, "a", "imported"),
                turn(0, 400, "a", "imported"),
                turn(0, 400, "a", "imported"),
            ],
            vec![turn(0, 1000, "a", "mic")],
            vec![turn(1100, 2000, "a", "imported")],
            vec![
                turn(0, 1000, "a", "imported"),
                turn(400, 600, "b", "imported"),
            ],
            vec![turn(0, 600, "a", "imported")],
            vec![
                turn(0, 800, "a", "imported"),
                turn(800, 1000, "b", "imported"),
            ],
            vec![
                turn(0, 800, "a", "imported"),
                turn(500, 600, "unknown", "imported"),
            ],
            vec![],
        ] {
            attribute_segments(&mut segments, &turns);
            assert!(segments[0].speaker.is_none());
        }
    }
}
