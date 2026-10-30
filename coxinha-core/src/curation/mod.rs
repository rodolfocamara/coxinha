//! Private human voice curation. Experimental comparisons never change recognition.
use crate::{
    identity::{EmbeddingSpace, SampleProvenance},
    processing::{ProcessingReport, SpeakerTurn},
    store::Store,
};
use anyhow::{ensure, Result};
use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
mod candidates;
mod errors;
mod paging;
mod preparation_budget;
mod report_collections;
pub use errors::CurationError;
pub use paging::InventoryPager;
mod comparison;
mod inventory;
mod selected;
pub use comparison::PreparedComparison;
pub use selected::SelectedEnrollment;

const MAX_REPORT_TURNS: usize = 4096;
const MAX_INVENTORY: usize = 4096;
const MAX_SELECTED: usize = 128;

pub(super) struct Candidate {
    turn: SpeakerTurn,
    space: Option<EmbeddingSpace>,
    vector: Vec<f32>,
    provenance: Option<SampleProvenance>,
    reasons: Vec<&'static str>,
    active_count: usize,
}
impl Candidate {
    fn eligible(&self) -> bool {
        self.reasons.is_empty()
    }
}
fn snapshot(store: &Store) -> Result<Transaction<'_>> {
    Ok(Transaction::new_unchecked(
        &store.profiles,
        TransactionBehavior::Deferred,
    )?)
}
fn legacy_sample_budget(store: &Store) -> Result<()> {
    let (count,bytes): (i64,i64) = store.profiles.query_row("SELECT count(*),coalesce(sum(length(provenance_json)+length(vector_json)),0) FROM voice_sample",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
    ensure!(
        count <= MAX_INVENTORY as i64 && bytes <= 32 * 1024 * 1024,
        "private sample inventory budget exceeded"
    );
    Ok(())
}

fn active_usage(store: &Store) -> Result<(usize, usize)> {
    preparation_budget::aggregate(&store.profiles,"SELECT count(*),count(n),sum(n) FROM (SELECT length(CAST(s.provenance_json AS BLOB))+length(CAST(s.vector_json AS BLOB)) AS n FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id)",[])
}
fn active_budget(store: &Store) -> Result<(usize, usize)> {
    let usage = active_usage(store)?;
    ensure!(
        usage.0 <= MAX_INVENTORY && usage.1 <= 32 * 1024 * 1024,
        CurationError::Capacity
    );
    Ok(usage)
}

fn generation(store: &Store) -> Result<i64> {
    Ok(store.profiles.query_row(
        "SELECT revision FROM profile_revision WHERE id=1",
        [],
        |r| r.get(0),
    )?)
}
fn bounded_report(
    store: &Store,
    job: &str,
) -> Result<(String, ProcessingReport, crate::capture::CaptureManifest)> {
    preparation_budget::admit_report(store, job)?;
    let (meeting, len, input): (String, i64, String) = store.db.query_row("SELECT j.meeting_id,length(r.result_json),j.input_json FROM job j JOIN processing_run r ON r.job_id=j.id WHERE j.id=?1 AND j.state='succeeded' AND j.stage='local-processing'", [job], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    ensure!(
        len <= 16 * 1024 * 1024,
        "curation report size limit exceeded"
    );
    let report = store.processing_report_by_job(job)?;
    ensure!(
        report.turns.len() <= MAX_REPORT_TURNS,
        "curation turn limit exceeded"
    );
    let mut turn_ids = BTreeSet::new();
    ensure!(
        report
            .turns
            .iter()
            .all(|t| !t.id.is_empty() && turn_ids.insert(&t.id)),
        "invalid canonical turn IDs"
    );
    let path = store.root.join("raw").join(&meeting).join("manifest.json");
    ensure!(
        !path.symlink_metadata()?.file_type().is_symlink(),
        "manifest symlink rejected"
    );
    ensure!(
        path.metadata()?.len() <= 1024 * 1024,
        "manifest size limit exceeded"
    );
    let manifest: crate::capture::CaptureManifest =
        serde_json::from_reader(std::fs::File::open(path)?)?;
    let input: crate::jobs::JobInput = serde_json::from_str(&input)?;
    ensure!(
        manifest.meeting == meeting
            && crate::processing::hash_json(&manifest)? == input.artifact_sha256,
        "processing source manifest mismatch"
    );
    Ok((meeting, report, manifest))
}
fn space_key(space: &EmbeddingSpace) -> Result<String> {
    Ok(serde_json::to_string(space)?)
}
fn valid_vector(space: &EmbeddingSpace, vector: &[f32]) -> bool {
    space.validate().is_ok() && crate::identity::vector_norm(vector, space.dimension).is_ok()
}
fn space_json(r: &rusqlite::Row<'_>, start: usize) -> rusqlite::Result<EmbeddingSpace> {
    Ok(EmbeddingSpace {
        model: r.get(start)?,
        revision: r.get(start + 1)?,
        model_hash: r.get(start + 2)?,
        preprocessing: r.get(start + 3)?,
        dimension: r.get::<_, i64>(start + 4)?.try_into().unwrap_or(0),
    })
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "tests/comparison_v1_reference.rs"]
mod comparison_v1_reference;
