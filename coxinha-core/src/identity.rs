use crate::{artifacts::validate_hash, store::Store};
use anyhow::{ensure, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmbeddingSpace {
    pub model: String,
    pub revision: String,
    pub model_hash: String,
    pub preprocessing: String,
    pub dimension: usize,
}
impl EmbeddingSpace {
    pub(crate) fn validate(&self) -> Result<()> {
        ensure!(
            !self.model.trim().is_empty()
                && !self.revision.trim().is_empty()
                && !self.preprocessing.trim().is_empty(),
            "complete embedding space required"
        );
        validate_hash(&self.model_hash)?;
        ensure!(
            self.dimension > 0 && self.dimension <= 65536,
            "invalid embedding dimension"
        );
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SampleProvenance {
    pub meeting: String,
    pub track: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub audio_sha256: String,
    pub device: String,
    pub quality_note: String,
}
impl SampleProvenance {
    pub(crate) fn validate(&self) -> Result<()> {
        uuid::Uuid::parse_str(&self.meeting)?;
        ensure!(
            matches!(self.track.as_str(), "mic" | "output" | "imported"),
            "invalid source track"
        );
        ensure!(self.end_ms > self.start_ms, "empty sample interval");
        ensure!(
            !self.device.trim().is_empty() && !self.quality_note.trim().is_empty(),
            "device and quality provenance required"
        );
        validate_hash(&self.audio_sha256)
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Calibration {
    pub space_id: String,
    pub evidence: String,
    pub minimum_samples: usize,
    pub minimum_duration_ms: u64,
    pub cosine_threshold: f64,
    pub candidate_margin: f64,
}
#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub enum MatchResult {
    Unknown {
        reason: String,
    },
    Suggestion {
        person_id: String,
        cosine_similarity: f64,
        calibration_evidence: String,
    },
}
pub(crate) fn vector_norm(vector: &[f32], dimension: usize) -> Result<f64> {
    ensure!(vector.len() == dimension, "embedding dimension mismatch");
    ensure!(
        vector.iter().all(|v| v.is_finite()),
        "embedding must be finite"
    );
    let norm = vector
        .iter()
        .map(|x| (*x as f64).powi(2))
        .sum::<f64>()
        .sqrt();
    ensure!(
        norm.is_finite() && norm > 0.0,
        "embedding norm must be positive"
    );
    Ok(norm)
}
impl Store {
    pub fn create_person(
        &self,
        name: &str,
        aliases: &[String],
        consent_origin: &str,
    ) -> Result<String> {
        ensure!(
            !name.trim().is_empty() && !consent_origin.trim().is_empty(),
            "name and consent origin required"
        );
        let id = uuid::Uuid::new_v4().to_string();
        self.profiles.execute(
            "INSERT INTO person VALUES(?1,?2,?3,?4)",
            params![id, name, serde_json::to_string(aliases)?, consent_origin],
        )?;
        Ok(id)
    }
    pub fn register_space(&self, space: &EmbeddingSpace) -> Result<String> {
        space.validate()?;
        self.profiles.execute("INSERT INTO embedding_space VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(model,revision,model_hash,preprocessing,dimension) DO NOTHING",params![uuid::Uuid::new_v4().to_string(),space.model,space.revision,space.model_hash,space.preprocessing,space.dimension as i64])?;
        Ok(self.profiles.query_row("SELECT id FROM embedding_space WHERE model=?1 AND revision=?2 AND model_hash=?3 AND preprocessing=?4 AND dimension=?5",params![space.model,space.revision,space.model_hash,space.preprocessing,space.dimension as i64],|r|r.get(0))?)
    }
    pub fn suggest_assignment(
        &self,
        meeting: &str,
        speaker: &str,
        person: Option<&str>,
    ) -> Result<String> {
        ensure!(!speaker.trim().is_empty(), "speaker required");
        let _: String =
            self.db
                .query_row("SELECT id FROM meeting WHERE id=?1", [meeting], |r| {
                    r.get(0)
                })?;
        let id = uuid::Uuid::new_v4().to_string();
        self.profiles.execute("INSERT INTO assignment(id,meeting_id,speaker,person_id,state,derived_generation) VALUES(?1,?2,?3,?4,'suggested',(SELECT revision FROM profile_revision WHERE id=1))",params![id,meeting,speaker,person])?;
        Ok(id)
    }
    /// Every decision appends history and invalidates samples tied to the previous revision.
    pub fn decide_assignment(
        &mut self,
        id: &str,
        person: Option<&str>,
        state: &str,
        human_origin: &str,
    ) -> Result<()> {
        ensure!(
            matches!(state, "confirmed" | "rejected" | "revoked"),
            "decision must be human-authored"
        );
        ensure!(
            state != "confirmed" || person.is_some(),
            "confirmation requires a person"
        );
        ensure!(
            !human_origin.trim().is_empty(),
            "human confirmation origin required"
        );
        let tx = self.profiles.transaction()?;
        ensure!(tx.execute("UPDATE assignment SET person_id=?2,state=?3,human_origin=?4,revision=revision+1 WHERE id=?1",params![id,person,state,human_origin])?==1,"assignment not found");
        tx.execute("INSERT INTO assignment_event(assignment_id,revision,person_id,state,human_origin) SELECT id,revision,person_id,state,human_origin FROM assignment WHERE id=?1",[id])?;
        tx.execute(
            "UPDATE profile_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn revoke_sample(&mut self, id: &str) -> Result<()> {
        let tx = self.profiles.transaction()?;
        ensure!(
            tx.execute("UPDATE voice_sample SET revoked=1 WHERE id=?1", [id])? == 1,
            "sample not found"
        );
        tx.execute(
            "UPDATE profile_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn assignment_is_stale(&self, id: &str) -> Result<bool> {
        Ok(self.profiles.query_row("SELECT state='suggested' AND derived_generation != (SELECT revision FROM profile_revision WHERE id=1) FROM assignment WHERE id=?1",[id],|r|r.get(0))?)
    }
    /// No mutation, no enrollment, no hardcoded threshold or inferred owner.
    pub fn match_voice(
        &self,
        space: &str,
        vector: &[f32],
        calibration: Option<&Calibration>,
    ) -> Result<MatchResult> {
        let dimension: usize = self
            .profiles
            .query_row(
                "SELECT dimension FROM embedding_space WHERE id=?1",
                [space],
                |r| r.get::<_, i64>(0),
            )?
            .try_into()?;
        let norm = vector_norm(vector, dimension)?;
        let unknown = |reason: &str| MatchResult::Unknown {
            reason: reason.into(),
        };
        let Some(c) = calibration else {
            return Ok(unknown("uncalibrated embedding space"));
        };
        ensure!(
            c.space_id == space && !c.evidence.trim().is_empty(),
            "calibration does not cover this space"
        );
        ensure!(
            c.minimum_samples > 0
                && c.minimum_duration_ms > 0
                && c.cosine_threshold.is_finite()
                && (-1.0..=1.0).contains(&c.cosine_threshold)
                && c.candidate_margin.is_finite()
                && (0.0..=2.0).contains(&c.candidate_margin),
            "invalid calibration policy"
        );
        let mut q=self.profiles.prepare("SELECT s.person_id,s.vector_json,s.provenance_json FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.space_id=?1 AND s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id")?;
        let mut scores: BTreeMap<String, (f64, usize, u64)> = BTreeMap::new();
        for row in q.query_map([space], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (person, v, p) = row?;
            let v: Vec<f32> = serde_json::from_str(&v)?;
            let p: SampleProvenance = serde_json::from_str(&p)?;
            let n = vector_norm(&v, dimension)?;
            let score = v
                .iter()
                .zip(vector)
                .map(|(a, b)| *a as f64 * *b as f64)
                .sum::<f64>()
                / (n * norm);
            let entry = scores.entry(person).or_insert((-1.0, 0, 0));
            entry.0 = entry.0.max(score.clamp(-1.0, 1.0));
            entry.1 += 1;
            entry.2 += p.end_ms - p.start_ms;
        }
        let mut candidates: Vec<_> = scores
            .into_iter()
            .filter(|(_, (_, n, d))| *n >= c.minimum_samples && *d >= c.minimum_duration_ms)
            .collect();
        candidates.sort_by(|a, b| b.1 .0.total_cmp(&a.1 .0));
        let Some((person, (score, _, _))) = candidates.first() else {
            return Ok(unknown("insufficient confirmed samples"));
        };
        if *score < c.cosine_threshold {
            return Ok(unknown("below calibrated threshold"));
        }
        if candidates
            .get(1)
            .is_some_and(|(_, s)| *score - s.0 <= c.candidate_margin)
        {
            return Ok(unknown("ambiguous candidates"));
        }
        Ok(MatchResult::Suggestion {
            person_id: person.clone(),
            cosine_similarity: *score,
            calibration_evidence: c.evidence.clone(),
        })
    }
}

#[cfg(test)]
#[path = "identity/tests.rs"]
mod tests;

mod enrollment;
