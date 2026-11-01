//! The transcript text that may leave the computer (ADR 0024 item 1).

/// One line of the live transcript, as the P3 pipeline produces it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TranscriptLine {
    pub start_ms: u64,
    pub speaker_hint: Option<String>,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExcerptMode {
    /// Lines that start within the first N minutes.
    FirstMinutes(u64),
    /// Lines evenly sampled across the whole meeting.
    Sampled,
}

/// Conservative token estimate: 3 characters per token (spec 0097 P4).
pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(3)
}

/// Whole lines, oldest first, never above `max_tokens` by `estimate_tokens`.
pub fn build_excerpt(lines: &[TranscriptLine], mode: ExcerptMode, max_tokens: usize) -> String {
    let max_chars = max_tokens.saturating_mul(3);
    let rendered: Vec<String> = match mode {
        ExcerptMode::FirstMinutes(minutes) => {
            let end_ms = minutes.saturating_mul(60_000);
            lines
                .iter()
                .filter(|l| l.start_ms < end_ms)
                .filter_map(render)
                .collect()
        }
        ExcerptMode::Sampled => lines.iter().filter_map(render).collect(),
    };
    let selected: Vec<&str> = match mode {
        ExcerptMode::FirstMinutes(_) => rendered.iter().map(String::as_str).collect(),
        ExcerptMode::Sampled => sample(&rendered, max_chars),
    };
    join_capped(&selected, max_chars)
}

/// `[mm:ss] Speaker: text` on a single line; `None` for silent lines.
fn render(line: &TranscriptLine) -> Option<String> {
    let text = collapse(&line.text);
    if text.is_empty() {
        return None;
    }
    let secs = line.start_ms / 1000;
    let stamp = format!("[{:02}:{:02}]", secs / 60, secs % 60);
    Some(
        match line
            .speaker_hint
            .as_deref()
            .map(collapse)
            .filter(|s| !s.is_empty())
        {
            Some(speaker) => format!("{stamp} {speaker}: {text}"),
            None => format!("{stamp} {text}"),
        },
    )
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn joined_len(lines: &[&str]) -> usize {
    lines.iter().map(|l| l.chars().count()).sum::<usize>() + lines.len().saturating_sub(1)
}

/// The largest evenly spaced selection, first and last line included, that
/// fits; starts from the average-length estimate and shrinks.
fn sample(lines: &[String], max_chars: usize) -> Vec<&str> {
    let all: Vec<&str> = lines.iter().map(String::as_str).collect();
    let total = joined_len(&all);
    if total <= max_chars {
        return all;
    }
    let n = all.len();
    let mut k = (n.saturating_mul(max_chars) / total).clamp(1, n);
    loop {
        let picked: Vec<&str> = if k == 1 {
            vec![all[0]]
        } else {
            (0..k).map(|i| all[i * (n - 1) / (k - 1)]).collect()
        };
        if k == 1 || joined_len(&picked) <= max_chars {
            return picked;
        }
        k -= 1;
    }
}

/// Appends whole lines while they fit. A first line longer than the cap is
/// cut on a character boundary so the excerpt is never empty by accident.
fn join_capped(lines: &[&str], max_chars: usize) -> String {
    let mut out = String::new();
    let mut used = 0;
    for line in lines {
        let len = line.chars().count();
        let sep = usize::from(!out.is_empty());
        if used + sep + len <= max_chars {
            if sep == 1 {
                out.push('\n');
            }
            out.push_str(line);
            used += sep + len;
        } else {
            if out.is_empty() {
                out.extend(line.chars().take(max_chars));
            }
            break;
        }
    }
    out
}

#[cfg(test)]
#[path = "excerpt_tests.rs"]
mod tests;
