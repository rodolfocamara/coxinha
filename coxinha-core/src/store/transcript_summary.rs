//! Read-only transcript coverage, independent of the latest processing job state.
use super::Store;
use crate::processing::{SpeakerTurn, TranscriptSegment};
use anyhow::Result;
use rusqlite::types::ValueRef;
use serde::{de::SeqAccess, Deserialize, Deserializer, Serialize};
use std::{collections::HashMap, fmt, marker::PhantomData};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptStatus {
    Available,
    #[default]
    None,
    Empty,
    Unavailable,
}

// Same selection as processing_report: a successful generic job without a
// processing_run is excluded; a newer empty/corrupt successful run still wins.
const LATEST_RESULTS: &str = "
    SELECT j.meeting_id, r.result_json
    FROM (
        SELECT j.meeting_id, MAX(j.rowid) AS job_rowid
        FROM job j JOIN processing_run r ON r.job_id = j.id
        WHERE j.state = 'succeeded' AND (?1 IS NULL OR j.meeting_id = ?1)
        GROUP BY j.meeting_id
    ) latest
    JOIN job j ON j.rowid = latest.job_rowid
    JOIN processing_run r ON r.job_id = j.id";

impl Store {
    /// One batch metadata query. No report/profile joins or raw/artifact IO.
    /// Absent map entries mean no successful processing run, not empty output.
    pub fn meeting_transcript_statuses(&self) -> Result<HashMap<String, TranscriptStatus>> {
        self.transcript_statuses(None)
    }

    pub fn meeting_transcript_status(&self, meeting: &str) -> Result<TranscriptStatus> {
        Ok(self
            .transcript_statuses(Some(meeting))?
            .remove(meeting)
            .unwrap_or_default())
    }

    fn transcript_statuses(
        &self,
        meeting: Option<&str>,
    ) -> Result<HashMap<String, TranscriptStatus>> {
        let mut query = self.db.prepare(LATEST_RESULTS)?;
        let rows = query.query_map([meeting], |row| {
            // Borrow SQLite's text buffer. Bad payloads stay local to this row;
            // actual SQL failures still propagate instead of masquerading as none.
            let status = match row.get_ref(1)? {
                ValueRef::Text(bytes) => summarize(bytes),
                _ => TranscriptStatus::Unavailable,
            };
            Ok((row.get(0)?, status))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

fn summarize(bytes: &[u8]) -> TranscriptStatus {
    match serde_json::from_slice::<SummaryResult>(bytes) {
        Ok(result) if result.segments => TranscriptStatus::Available,
        Ok(_) => TranscriptStatus::Empty,
        Err(_) => TranscriptStatus::Unavailable,
    }
}

// Validate the same required fields and element types as ProcessingResult, but
// retain only presence. Peak deserialization memory is one element, not a report.
#[derive(Deserialize)]
struct SummaryResult {
    #[serde(deserialize_with = "segment_presence")]
    segments: bool,
    #[serde(rename = "turns")]
    _turns: ValidatedSequence<SpeakerTurn>,
    #[serde(rename = "warnings")]
    _warnings: ValidatedSequence<String>,
}

fn segment_presence<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    struct Presence;
    impl<'de> serde::de::Visitor<'de> for Presence {
        type Value = bool;
        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("an array of transcript segments")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<bool, A::Error> {
            let mut available = false;
            while let Some(segment) = sequence.next_element::<TranscriptSegment>()? {
                available |= !segment.text.trim().is_empty();
            }
            // Do not stop at the first text: a later malformed segment invalidates
            // the saved result just as it does in processing_report.
            Ok(available)
        }
    }
    deserializer.deserialize_seq(Presence)
}

struct ValidatedSequence<T>(PhantomData<T>);
impl<'de, T: Deserialize<'de>> Deserialize<'de> for ValidatedSequence<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Elements<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Elements<T> {
            type Value = ValidatedSequence<T>;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("an array of processing result elements")
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                while sequence.next_element::<T>()?.is_some() {}
                Ok(ValidatedSequence(PhantomData))
            }
        }
        deserializer.deserialize_seq(Elements(PhantomData))
    }
}

#[cfg(test)]
mod tests;
