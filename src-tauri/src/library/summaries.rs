//! Summary bookkeeping on the library actor (spec 0108). The LLM call runs
//! outside; the actor only picks the next transcript and stores the answer.
use super::*;
use coxinha_core::processing::{named_lines, named_transcript, ProcessingReport};
use coxinha_core::store::StoredSummary;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;

pub(super) enum SummaryAction {
    Get(String),
    Next(Vec<String>),
    Source(String),
    Save(StoredSummaryInput),
}

/// What the summarizer reads: the confirmed-name transcript of one job.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarySource {
    pub meeting_id: String,
    pub job_id: String,
    /// `(start_ms, speaker, text)`, time order, silent lines dropped.
    pub lines: Vec<(u64, String, String)>,
    pub source_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredSummaryInput {
    pub meeting_id: String,
    pub job_id: String,
    pub markdown: String,
    pub model: String,
    pub generated_at: String,
    pub source_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummary {
    pub markdown: String,
    pub generated_at: String,
}

/// `None` when the report holds no spoken text.
pub(crate) fn source_of(meeting: &str, report: &ProcessingReport) -> Option<SummarySource> {
    let lines: Vec<(u64, String, String)> = named_lines(report)
        .into_iter()
        .filter(|line| !line.text.is_empty())
        .map(|line| (line.start_ms, line.speaker, line.text))
        .collect();
    if lines.is_empty() {
        return None;
    }
    Some(SummarySource {
        meeting_id: meeting.to_string(),
        job_id: report.job.clone(),
        lines,
        source_sha256: format!("{:x}", Sha256::digest(named_transcript(report).as_bytes())),
    })
}

impl Worker {
    pub(super) fn summary_action(&mut self, action: SummaryAction) -> anyhow::Result<Value> {
        match action {
            SummaryAction::Get(meeting) => Ok(json!(self
                .store
                .meeting_summary_record(&meeting)?
                .map(|s| MeetingSummary {
                    markdown: s.markdown,
                    generated_at: s.generated_at,
                }))),
            SummaryAction::Next(skip) => Ok(json!(self.next_summary_source(&skip)?)),
            SummaryAction::Source(meeting) => {
                let report = self
                    .store
                    .processing_report(&meeting)
                    .map_err(|_| anyhow::anyhow!("this meeting has no transcript yet"))?;
                let source = source_of(&meeting, &report)
                    .ok_or_else(|| anyhow::anyhow!("the transcript has no spoken text"))?;
                Ok(json!(source))
            }
            SummaryAction::Save(input) => {
                self.store.save_meeting_summary(&StoredSummary {
                    meeting_id: input.meeting_id,
                    job_id: input.job_id,
                    markdown: input.markdown,
                    model: input.model,
                    generated_at: input.generated_at,
                    source_sha256: input.source_sha256,
                })?;
                Ok(Value::Null)
            }
        }
    }

    /// The newest transcript that needs a summary. Meetings without spoken
    /// text are passed over; a rerun with the same words keeps its summary.
    pub(super) fn next_summary_source(
        &mut self,
        skip: &[String],
    ) -> anyhow::Result<Option<SummarySource>> {
        for (meeting, job) in self.store.summary_candidates()? {
            if skip.contains(&meeting) {
                continue;
            }
            let Ok(report) = self.store.processing_report_by_job(&job) else {
                continue;
            };
            let Some(source) = source_of(&meeting, &report) else {
                continue;
            };
            let existing = self.store.meeting_summary_record(&meeting)?;
            if existing.is_some_and(|s| s.source_sha256 == source.source_sha256) {
                self.store.retag_meeting_summary(&meeting, &job)?;
                continue;
            }
            return Ok(Some(source));
        }
        Ok(None)
    }
}

impl Library {
    pub async fn summary(&self, meeting: String) -> Result<Option<MeetingSummary>, String> {
        let value = self
            .ask(Action::Summary(SummaryAction::Get(meeting)))
            .await?;
        serde_json::from_value(value).map_err(|e| e.to_string())
    }
    pub async fn next_summary_source(
        &self,
        skip: Vec<String>,
    ) -> Result<Option<SummarySource>, String> {
        let value = self.ask(Action::Summary(SummaryAction::Next(skip))).await?;
        serde_json::from_value(value).map_err(|e| e.to_string())
    }
    pub async fn summary_source(&self, meeting: String) -> Result<SummarySource, String> {
        let value = self
            .ask(Action::Summary(SummaryAction::Source(meeting)))
            .await?;
        serde_json::from_value(value).map_err(|e| e.to_string())
    }
    pub async fn save_summary(&self, input: StoredSummaryInput) -> Result<(), String> {
        self.ask(Action::Summary(SummaryAction::Save(input)))
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
#[path = "summaries_tests.rs"]
mod tests;
