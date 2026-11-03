use super::*;
use rusqlite::{params, OptionalExtension};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AssignmentView {
    pub id: String,
    pub speaker: String,
    pub track: Option<String>,
    pub person_id: Option<String>,
    pub state: String,
    pub name: Option<String>,
    /// Voice memory of a confirmed assignment (spec 0120).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<VoiceState>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VoiceState {
    /// `pending`, `enrolled`, `failed` or `off`.
    pub state: String,
    pub samples: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
const VOICE_COLUMNS: &str = "CASE WHEN a.state<>'confirmed' OR a.person_id IS NULL THEN NULL WHEN EXISTS(SELECT 1 FROM voice_memory_off o WHERE o.person_id=a.person_id) THEN 'off' ELSE coalesce((SELECT e.state FROM voice_enrollment e WHERE e.assignment_id=a.id AND e.assignment_revision=a.revision),'pending') END,(SELECT e.error FROM voice_enrollment e WHERE e.assignment_id=a.id AND e.assignment_revision=a.revision),(SELECT count(*) FROM voice_sample s WHERE s.assignment_id=a.id AND s.assignment_revision=a.revision AND s.person_id=a.person_id AND s.revoked=0)";
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcessingReport {
    pub job: String,
    pub segments: Vec<TranscriptSegment>,
    pub turns: Vec<SpeakerTurn>,
    pub warnings: Vec<String>,
    pub assignments: Vec<AssignmentView>,
    pub corrections: BTreeMap<String, String>,
}
/// The latest successful report of a meeting; read-only callers (the CLI)
/// pass their own connections because the app holds the library lock.
pub fn latest_report(
    db: &rusqlite::Connection,
    profiles: &rusqlite::Connection,
    meeting: &str,
) -> Result<Option<ProcessingReport>> {
    let job: Option<String> = db.query_row("SELECT j.id FROM job j JOIN processing_run r ON r.job_id=j.id WHERE j.meeting_id=?1 AND j.state='succeeded' ORDER BY j.rowid DESC LIMIT 1",[meeting],|r|r.get(0)).optional()?;
    job.map(|job| report_for_job(db, profiles, &job))
        .transpose()
}
pub fn report_for_job(
    db: &rusqlite::Connection,
    profiles: &rusqlite::Connection,
    job: &str,
) -> Result<ProcessingReport> {
    let (meeting,json):(String,String)=db.query_row("SELECT j.meeting_id,r.result_json FROM job j JOIN processing_run r ON r.job_id=j.id WHERE j.id=?1 AND j.state='succeeded'",[job],|r|Ok((r.get(0)?,r.get(1)?)))?;
    let job = job.to_owned();
    let result: ProcessingResult = serde_json::from_str(&json)?;
    let mut corrections = BTreeMap::new();
    for segment in &result.segments {
        if let Some(text) =
            crate::store::latest_edit(db, &meeting, &format!("{job}:{}", segment.id))?
        {
            corrections.insert(segment.id.clone(), text);
        }
    }
    // Read-only callers may hold a library the app has not migrated yet.
    let migrated: bool = profiles.query_row(
        "SELECT count(*)=2 FROM sqlite_master WHERE type='table' AND name IN ('voice_enrollment','voice_memory_off')",
        [],
        |r| r.get(0),
    )?;
    let voice = if migrated {
        VOICE_COLUMNS
    } else {
        "NULL,NULL,0"
    };
    let mut q=profiles.prepare(&format!("SELECT a.id,a.speaker,a.person_id,a.state,p.name,{voice} FROM assignment a LEFT JOIN person p ON p.id=a.person_id WHERE a.meeting_id=?1 AND a.speaker LIKE ?2"))?;
    let prefix = format!("{job}:");
    let assignments = q
        .query_map(params![meeting, format!("{prefix}%")], |r| {
            let speaker: String = r.get(1)?;
            Ok(AssignmentView {
                id: r.get(0)?,
                track: speaker
                    .strip_prefix(&prefix)
                    .and_then(|s| s.split_once(':'))
                    .map(|(t, _)| t.to_string()),
                speaker: speaker
                    .strip_prefix(&prefix)
                    .unwrap_or(&speaker)
                    .split_once(':')
                    .map(|(_, s)| s)
                    .unwrap_or(speaker.strip_prefix(&prefix).unwrap_or(&speaker))
                    .into(),
                person_id: r.get(2)?,
                state: r.get(3)?,
                name: r.get(4)?,
                voice: r.get::<_, Option<String>>(5)?.map(|state| VoiceState {
                    state,
                    error: r.get(6).ok().flatten(),
                    samples: r.get(7).unwrap_or(0),
                }),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ProcessingReport {
        job,
        segments: result.segments,
        turns: result.turns,
        warnings: result.warnings,
        assignments,
        corrections,
    })
}
