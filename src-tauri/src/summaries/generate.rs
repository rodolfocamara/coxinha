//! Map-reduce over transcript chunks so every request stays within the
//! per-request transcript cap of ADR 0024 while the summary covers the whole
//! meeting (spec 0108).
use super::prompt::{self, Language, Prompt};
use crate::titles::sanitize::strip_think;
use crate::titles::{chunk_lines, estimate_tokens, TranscriptLine, MAX_EXCERPT_TOKENS};
use std::future::Future;
use std::time::Duration;

/// Errors from the model call that a later attempt may fix.
#[derive(Debug, PartialEq, Eq)]
pub enum SummaryError {
    Transport(String),
    Unusable,
    Empty,
}

impl std::fmt::Display for SummaryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(e) => write!(f, "{e}"),
            Self::Unusable => write!(f, "the model returned no usable summary"),
            Self::Empty => write!(f, "the transcript has no spoken text"),
        }
    }
}

/// `ask` performs one request; tests pass a fake.
pub async fn summarize<F, Fut>(lines: &[TranscriptLine], ask: F) -> Result<String, SummaryError>
where
    F: Fn(Prompt) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    summarize_with(lines, MAX_EXCERPT_TOKENS, ask).await
}

pub(super) async fn summarize_with<F, Fut>(
    lines: &[TranscriptLine],
    budget: usize,
    ask: F,
) -> Result<String, SummaryError>
where
    F: Fn(Prompt) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let chunks = chunk_lines(lines, budget);
    if chunks.is_empty() {
        return Err(SummaryError::Empty);
    }
    let lang = prompt::detect(&chunks.join("\n"));
    let call = |p: Prompt| async { ask(p).await.map_err(SummaryError::Transport) };
    let raw = if chunks.len() == 1 {
        call(prompt::whole(lang, &chunks[0])).await?
    } else {
        let mut notes = Vec::with_capacity(chunks.len());
        for (i, chunk) in chunks.iter().enumerate() {
            let answer = call(prompt::part(lang, i + 1, chunks.len(), chunk)).await?;
            notes.push(strip_think(&answer).trim().to_string());
        }
        let notes = reduce(lang, notes, budget, &call).await?;
        call(prompt::from_notes(lang, &notes)).await?
    };
    prompt::sanitize_summary(&raw).ok_or(SummaryError::Unusable)
}

/// Merges notes in groups until they fit one request.
async fn reduce<C, Fut>(
    lang: Language,
    mut notes: Vec<String>,
    budget: usize,
    call: &C,
) -> Result<String, SummaryError>
where
    C: Fn(Prompt) -> Fut,
    Fut: Future<Output = Result<String, SummaryError>>,
{
    for round in 0.. {
        let joined = notes.join("\n\n");
        if estimate_tokens(&joined) <= budget || notes.len() <= 1 {
            return Ok(joined);
        }
        // A model that never shortens must not loop: keep what fits.
        if round == MAX_ROUNDS {
            return Ok(joined.chars().take(budget.saturating_mul(3)).collect());
        }
        let mut merged = Vec::new();
        let mut group = String::new();
        for note in notes {
            let candidate = if group.is_empty() {
                note.clone()
            } else {
                format!("{group}\n\n{note}")
            };
            if estimate_tokens(&candidate) > budget && !group.is_empty() {
                merged.push(
                    strip_think(&call(prompt::merge(lang, &group)).await?)
                        .trim()
                        .to_string(),
                );
                group = note;
            } else {
                group = candidate;
            }
        }
        if !group.is_empty() {
            merged.push(
                strip_think(&call(prompt::merge(lang, &group)).await?)
                    .trim()
                    .to_string(),
            );
        }
        notes = merged;
    }
    unreachable!("the loop returns by MAX_ROUNDS")
}

const MAX_ROUNDS: usize = 4;

/// Waits after the n-th consecutive transport failure: 1, 2, 4… minutes,
/// at most six hours.
pub fn backoff(failures: u32) -> Duration {
    let minutes = 1u64 << failures.saturating_sub(1).min(9);
    Duration::from_secs((minutes * 60).min(6 * 3600))
}

#[cfg(test)]
#[path = "generate_tests.rs"]
mod tests;
