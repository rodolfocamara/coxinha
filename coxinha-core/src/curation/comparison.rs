use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
mod prepare;
mod score;

struct HistorySample {
    person: String,
    name: String,
    vector: Vec<f32>,
    norm: f64,
}
#[derive(Default)]
struct HistorySpace {
    compatible: usize,
    excluded: usize,
    invalid: usize,
    samples: Vec<HistorySample>,
}
struct QueryTurn {
    id: String,
    start: u64,
    end: u64,
    vector: Vec<f32>,
    norm: f64,
}
type Groups = BTreeMap<(String, String), BTreeMap<String, Vec<QueryTurn>>>;
/// Fully owned decoded evidence, without Store, connections, paths or callbacks.
pub struct PreparedComparison {
    job: String,
    generation: i64,
    groups: Groups,
    history: BTreeMap<String, HistorySpace>,
    workspace_bytes: usize,
}
impl PreparedComparison {
    pub fn profile_generation(&self) -> i64 {
        self.generation
    }
    pub fn accounted_workspace_bytes(&self) -> usize {
        self.workspace_bytes
    }
    pub fn score(self, cancel: &AtomicBool) -> Result<Value> {
        score::score(self, cancel)
    }
}
impl Store {
    pub fn curation_generation(&self) -> Result<i64> {
        generation(self)
    }
    pub fn prepare_voice_comparison(&self, job: &str) -> Result<PreparedComparison> {
        prepare::prepare(self, job)
    }
    pub fn voice_comparison(&self, job: &str) -> Result<Value> {
        self.prepare_voice_comparison(job)?
            .score(&AtomicBool::new(false))
    }
}
