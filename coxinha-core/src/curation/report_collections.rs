use super::{preparation_budget::ReadBudget, *};
use crate::processing::TranscriptSegment;

// Serde-derived structs accept both maps and field-order sequences. Choose the
// containing record's representation before projecting any reader-owned field.
pub(super) const SEGMENTS_PATH: &str =
    "CASE json_type(r.result_json) WHEN 'object' THEN '$.segments' WHEN 'array' THEN '$[0]' END";
const TURNS_PATH: &str =
    "CASE json_type(r.result_json) WHEN 'object' THEN '$.turns' WHEN 'array' THEN '$[1]' END";
const WARNINGS_PATH: &str =
    "CASE json_type(r.result_json) WHEN 'object' THEN '$.warnings' WHEN 'array' THEN '$[2]' END";
pub(super) const SEGMENT_ID_PATH: &str =
    "CASE json_type(seg.value) WHEN 'object' THEN '$.id' WHEN 'array' THEN '$[0]' END";
const EMBEDDING_PATH: &str =
    "CASE json_type(t.value) WHEN 'object' THEN '$.embedding' WHEN 'array' THEN '$[5]' END";

// serde_json sequences have no size hint; serde builds Vec with repeated push.
// For these non-byte, non-ZST types, the pinned Rust Vec starts at 4 and doubles.
// Preserve a checked upper bound including the discontinuity immediately above 2^k.
pub(super) fn capacity_bytes<T>(count: usize) -> Result<usize> {
    if count == 0 {
        return Ok(0);
    }
    count
        .max(4)
        .checked_next_power_of_two()
        .and_then(|capacity| capacity.checked_mul(std::mem::size_of::<T>()))
        .ok_or_else(|| CurationError::Capacity.into())
}
pub(super) fn count(n: Option<i64>) -> Result<usize> {
    usize::try_from(n.ok_or(CurationError::Capacity)?).map_err(|_| CurationError::Capacity.into())
}
fn vector<T>(budget: &mut ReadBudget, n: usize, buffers: usize) -> Result<()> {
    budget.charge(capacity_bytes::<T>(n)?, buffers)
}
pub(super) fn admit(store: &Store, job: &str, budget: &mut ReadBudget) -> Result<()> {
    let sql = format!("SELECT CASE WHEN json_type(r.result_json,{SEGMENTS_PATH})='array' THEN json_array_length(r.result_json,{SEGMENTS_PATH}) END, CASE WHEN json_type(r.result_json,{TURNS_PATH})='array' THEN json_array_length(r.result_json,{TURNS_PATH}) END, CASE WHEN json_type(r.result_json,{WARNINGS_PATH})='array' THEN json_array_length(r.result_json,{WARNINGS_PATH}) END FROM processing_run r WHERE r.job_id=?1");
    let counts: (Option<i64>, Option<i64>, Option<i64>) = store
        .db
        .query_row(&sql, [job], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|_| CurationError::Capacity)?;
    let (segments, turns, warnings) = (count(counts.0)?, count(counts.1)?, count(counts.2)?);
    // Original/growing Vec plus its previous buffer. Turns are also cloned into
    // Candidate, whose Vec can grow while the complete report remains alive.
    vector::<TranscriptSegment>(budget, segments, 2)?;
    vector::<SpeakerTurn>(budget, turns, 2)?;
    vector::<Candidate>(budget, turns, 2)?;
    vector::<String>(budget, warnings, 2)?;
    budget.charge(segments, 512)?;
    budget.charge(turns, 512)?;

    // Stream numeric lengths, never allocate an array/Value or a count registry.
    let sql = format!("SELECT CASE WHEN json_type(t.value,{EMBEDDING_PATH}) IS NULL OR json_type(t.value,{EMBEDDING_PATH})='null' THEN 0 WHEN json_type(t.value,{EMBEDDING_PATH})='array' THEN json_array_length(t.value,{EMBEDDING_PATH}) END FROM processing_run r JOIN json_each(r.result_json,{TURNS_PATH}) t WHERE r.job_id=?1");
    let mut q = store
        .db
        .prepare(&sql)
        .map_err(|_| CurationError::Capacity)?;
    let mut rows = q.query([job]).map_err(|_| CurationError::Capacity)?;
    let mut seen = 0usize;
    while let Some(row) = rows.next().map_err(|_| CurationError::Capacity)? {
        seen = seen.checked_add(1).ok_or(CurationError::Capacity)?;
        ensure!(seen <= turns, CurationError::Capacity);
        let n = count(row.get(0).map_err(|_| CurationError::Capacity)?)?;
        // Original embedding + candidate clone + one old growth/copy buffer.
        vector::<f32>(budget, n, 3)?;
    }
    ensure!(seen == turns, CurationError::Capacity);
    Ok(())
}
