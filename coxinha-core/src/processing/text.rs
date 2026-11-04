//! The readable transcript of a report: corrections applied, speaker names
//! only when the owner confirmed them (spec 0060). Shared by the CLI and the
//! summaries so both read the same words.
use super::ProcessingReport;

/// One spoken line in time order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NamedLine {
    pub start_ms: u64,
    pub speaker: String,
    pub text: String,
}

pub fn named_lines(report: &ProcessingReport) -> Vec<NamedLine> {
    let mut segments: Vec<_> = report.segments.iter().collect();
    segments.sort_by_key(|s| (s.start_ms, s.id.clone()));
    segments
        .into_iter()
        .map(|segment| {
            let speaker = segment
                .speaker
                .as_deref()
                .map(|speaker| {
                    report
                        .assignments
                        .iter()
                        .find(|a| {
                            a.speaker == speaker
                                && a.track.as_deref() == Some(segment.track.as_str())
                                && a.state == "confirmed"
                        })
                        .and_then(|a| a.name.clone())
                        .unwrap_or_else(|| speaker.to_string())
                })
                .unwrap_or_else(|| segment.track.clone());
            let text = report
                .corrections
                .get(&segment.id)
                .unwrap_or(&segment.text)
                .trim()
                .to_string();
            NamedLine {
                start_ms: segment.start_ms,
                speaker,
                text,
            }
        })
        .collect()
}

/// "[mm:ss] Name: text" per line.
pub fn named_transcript(report: &ProcessingReport) -> String {
    named_lines(report)
        .iter()
        .map(|line| {
            let seconds = line.start_ms / 1000;
            format!(
                "[{:02}:{:02}] {}: {}",
                seconds / 60,
                seconds % 60,
                line.speaker,
                line.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
