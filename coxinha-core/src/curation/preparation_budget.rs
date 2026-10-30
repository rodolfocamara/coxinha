use super::*;
use rusqlite::{Connection, Params};
const LIMIT: usize = 128 * 1024 * 1024;

#[derive(Default)]
pub(super) struct ReadBudget(usize);
impl ReadBudget {
    pub(super) fn charge(&mut self, bytes: usize, copies: usize) -> Result<()> {
        self.0 = self
            .0
            .checked_add(bytes.checked_mul(copies).ok_or(CurationError::Capacity)?)
            .ok_or(CurationError::Capacity)?;
        ensure!(self.0 <= LIMIT, CurationError::Capacity);
        Ok(())
    }
}
pub(super) fn checked_aggregate(
    rows: i64,
    values: i64,
    sum: Option<i64>,
) -> Result<(usize, usize)> {
    ensure!(rows >= 0 && values == rows, CurationError::Capacity);
    let rows = usize::try_from(rows).map_err(|_| CurationError::Capacity)?;
    let bytes = if rows == 0 {
        ensure!(sum.is_none_or(|n| n == 0), CurationError::Capacity);
        0
    } else {
        usize::try_from(sum.ok_or(CurationError::Capacity)?).map_err(|_| CurationError::Capacity)?
    };
    Ok((rows, bytes))
}
pub(super) fn aggregate<P: Params>(
    db: &Connection,
    sql: &str,
    params: P,
) -> Result<(usize, usize)> {
    let (rows, values, sum) = db
        .query_row(sql, params, |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|_| CurationError::Capacity)?;
    checked_aggregate(rows, values, sum)
}
fn scalar(n: i64) -> Result<usize> {
    usize::try_from(n).map_err(|_| CurationError::Capacity.into())
}
fn active(store: &Store, budget: &mut ReadBudget) -> Result<()> {
    let (rows,provenance)=aggregate(&store.profiles,"SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(s.provenance_json AS BLOB)) AS n FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id)",[])?;
    // Raw row JSON and its decoded source fields can coexist with the count map.
    budget.charge(provenance, 2)?;
    budget.charge(rows, 1024)?;
    let (vectors,vector_bytes)=aggregate(&store.profiles,"SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(s.vector_json AS BLOB)) AS n FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id)",[])?;
    ensure!(
        vectors == rows
            && provenance
                .checked_add(vector_bytes)
                .is_some_and(|n| n <= 32 * 1024 * 1024),
        CurationError::Capacity
    );
    budget.charge(vector_bytes, 2)?;
    let (spaces,metadata)=aggregate(&store.profiles,"SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(e.model AS BLOB))+length(CAST(e.revision AS BLOB))+length(CAST(e.model_hash AS BLOB))+length(CAST(e.preprocessing AS BLOB)) AS n FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id JOIN embedding_space e ON e.id=s.space_id WHERE s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id)",[])?;
    ensure!(spaces == rows, CurationError::Capacity);
    // Escaped JSON can expand sixfold; raw metadata and growing serialized keys coexist.
    budget.charge(metadata, 16)?;
    let (people,identities)=aggregate(&store.profiles,"SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(s.person_id AS BLOB))+length(CAST(p.name AS BLOB)) AS n FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id JOIN person p ON p.id=s.person_id WHERE s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id)",[])?;
    ensure!(people == rows, CurationError::Capacity);
    budget.charge(identities, 2)?;
    Ok(())
}
fn candidates(store: &Store, job: &str, budget: &mut ReadBudget) -> Result<()> {
    let (rows,text)=aggregate(&store.profiles,"SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(turn_id AS BLOB))+length(CAST(speaker AS BLOB))+length(CAST(space_json AS BLOB))+length(CAST(vector_json AS BLOB))+length(CAST(provenance_json AS BLOB)) AS n FROM processed_candidate WHERE job_id=?1)",[job])?;
    // Raw BTreeMap records, parsed vectors/fields and per-turn bindings overlap.
    budget.charge(text, 6)?;
    budget.charge(rows, 1024)?;
    Ok(())
}
pub(super) fn admit_active(store: &Store) -> Result<()> {
    let mut budget = ReadBudget::default();
    active(store, &mut budget)
}
pub(super) fn admit_candidates(store: &Store, job: &str) -> Result<()> {
    let mut budget = ReadBudget::default();
    active(store, &mut budget)?;
    candidates(store, job, &mut budget)
}
pub(super) fn admit_report(store: &Store, job: &str) -> Result<()> {
    let mut budget = ReadBudget::default();
    budget.charge(job.len(), 4)?;
    let sizes:rusqlite::Result<(i64,i64,i64)>=store.db.query_row("SELECT length(CAST(j.meeting_id AS BLOB)),length(CAST(j.input_json AS BLOB)),length(CAST(r.result_json AS BLOB)) FROM job j JOIN processing_run r ON r.job_id=j.id WHERE j.id=?1 AND j.state='succeeded' AND j.stage='local-processing'",[job],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)));
    let (meeting, input, report) = sizes.map_err(|e| {
        if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
            anyhow::Error::new(e)
        } else {
            CurationError::Capacity.into()
        }
    })?;
    budget.charge(scalar(meeting)?, 4)?;
    budget.charge(scalar(input)?, 2)?;
    // Raw report, parsed fields and cloned candidate turns may coexist.
    budget.charge(scalar(report)?, 8)?;
    super::report_collections::admit(store, job, &mut budget)?;
    let meeting: String = store
        .db
        .query_row("SELECT meeting_id FROM job WHERE id=?1", [job], |r| {
            r.get(0)
        })
        .map_err(|_| CurationError::Capacity)?;
    let(rows,assignment)=aggregate(&store.profiles,"SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(a.id AS BLOB))+length(CAST(a.speaker AS BLOB))+CASE WHEN a.person_id IS NULL THEN 0 ELSE length(CAST(a.person_id AS BLOB)) END+length(CAST(a.state AS BLOB))+CASE WHEN p.name IS NULL THEN 0 ELSE length(CAST(p.name AS BLOB)) END AS n FROM assignment a LEFT JOIN person p ON p.id=a.person_id WHERE a.meeting_id=?1 AND a.speaker LIKE (?2 || ':%'))",params![meeting,job])?;
    budget.charge(assignment, 2)?;
    budget.charge(rows, 512)?;
    // Match the reader's segment target and latest edit, excluding retained older revisions.
    let sql = format!("SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(h.body AS BLOB)) AS n FROM job j JOIN processing_run r ON r.job_id=j.id JOIN json_each(r.result_json,{}) seg JOIN human_edit h ON h.id=(SELECT e.id FROM human_edit e WHERE e.meeting_id=j.meeting_id AND e.target=j.id || ':' || json_extract(seg.value,{}) ORDER BY e.id DESC LIMIT 1) WHERE j.id=?1)", super::report_collections::SEGMENTS_PATH, super::report_collections::SEGMENT_ID_PATH);
    let (rows, edits) = aggregate(&store.db, &sql, [job])?;
    budget.charge(edits, 2)?;
    budget.charge(rows, 256)?;
    active(store, &mut budget)?;
    candidates(store, job, &mut budget)?;
    Ok(())
}
