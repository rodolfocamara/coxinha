//! Generated meeting summaries (spec 0108). Memory, not Knowledge (ADR
//! 0015): each row names the processing job and the hash of the transcript
//! it was written from, so a newer transcript makes it stale.
use super::Store;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

pub(super) const SCHEMA: &str = "CREATE TABLE meeting_summary(
 meeting_id TEXT PRIMARY KEY REFERENCES meeting(id),
 job_id TEXT NOT NULL,
 markdown TEXT NOT NULL,
 model TEXT NOT NULL,
 generated_at TEXT NOT NULL,
 source_sha256 TEXT NOT NULL
);";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredSummary {
    pub meeting_id: String,
    pub job_id: String,
    pub markdown: String,
    pub model: String,
    pub generated_at: String,
    pub source_sha256: String,
}

/// Read by connection too: the CLI opens the database read-only while the
/// app holds the library lock. A database without the table has no summaries.
pub fn read_summary(db: &Connection, meeting: &str) -> Result<Option<StoredSummary>> {
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='meeting_summary')",
        [],
        |r| r.get(0),
    )?;
    if !exists {
        return Ok(None);
    }
    Ok(db
        .query_row(
            "SELECT meeting_id,job_id,markdown,model,generated_at,source_sha256
             FROM meeting_summary WHERE meeting_id=?1",
            [meeting],
            |r| {
                Ok(StoredSummary {
                    meeting_id: r.get(0)?,
                    job_id: r.get(1)?,
                    markdown: r.get(2)?,
                    model: r.get(3)?,
                    generated_at: r.get(4)?,
                    source_sha256: r.get(5)?,
                })
            },
        )
        .optional()?)
}

impl Store {
    pub fn meeting_summary_record(&self, meeting: &str) -> Result<Option<StoredSummary>> {
        read_summary(&self.db, meeting)
    }

    pub fn save_meeting_summary(&self, summary: &StoredSummary) -> Result<()> {
        self.db.execute(
            "INSERT INTO meeting_summary(meeting_id,job_id,markdown,model,generated_at,source_sha256)
             VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(meeting_id) DO UPDATE SET job_id=excluded.job_id,
               markdown=excluded.markdown, model=excluded.model,
               generated_at=excluded.generated_at, source_sha256=excluded.source_sha256",
            params![
                summary.meeting_id,
                summary.job_id,
                summary.markdown,
                summary.model,
                summary.generated_at,
                summary.source_sha256
            ],
        )?;
        Ok(())
    }

    /// A rerun that produced the same words keeps the summary.
    pub fn retag_meeting_summary(&self, meeting: &str, job: &str) -> Result<()> {
        self.db.execute(
            "UPDATE meeting_summary SET job_id=?2 WHERE meeting_id=?1",
            params![meeting, job],
        )?;
        Ok(())
    }

    /// Meetings whose latest successful transcript has no summary yet, or a
    /// summary of an older job; newest first.
    pub fn summary_candidates(&self) -> Result<Vec<(String, String)>> {
        let mut query = self.db.prepare(
            "SELECT j.meeting_id, j.id
             FROM (
                 SELECT j.meeting_id, MAX(j.rowid) AS job_rowid
                 FROM job j JOIN processing_run r ON r.job_id = j.id
                 WHERE j.state = 'succeeded'
                 GROUP BY j.meeting_id
             ) latest
             JOIN job j ON j.rowid = latest.job_rowid
             LEFT JOIN meeting_summary s ON s.meeting_id = j.meeting_id
             WHERE s.meeting_id IS NULL OR s.job_id <> j.id
             ORDER BY j.rowid DESC",
        )?;
        let rows = query.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

#[cfg(test)]
#[path = "meeting_summary_tests.rs"]
mod tests;
