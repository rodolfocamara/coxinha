//! Private participant context and read-only, policy-versioned acoustic queries.
use crate::{
    identity::{Calibration, EmbeddingSpace, MatchResult},
    store::Store,
};
use anyhow::{ensure, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ParticipantContext {
    pub name: String,
    pub email: Option<String>,
}
impl Store {
    pub fn participant_context(&self, meeting: &str) -> Result<Vec<ParticipantContext>> {
        let _: String =
            self.db
                .query_row("SELECT id FROM meeting WHERE id=?1", [meeting], |r| {
                    r.get(0)
                })?;
        let text: Option<String> = self
            .profiles
            .query_row(
                "SELECT participants_json FROM participant_context WHERE meeting_id=?1",
                [meeting],
                |r| r.get(0),
            )
            .optional()?;
        Ok(match text {
            Some(text) => serde_json::from_str(&text)?,
            None => vec![],
        })
    }
    pub fn set_participant_context(
        &self,
        meeting: &str,
        participants: &[ParticipantContext],
    ) -> Result<()> {
        self.participant_context(meeting)?;
        ensure!(participants.len() <= 100, "at most 100 manual candidates");
        for p in participants {
            ensure!(
                !p.name.trim().is_empty()
                    && p.name.len() <= 500
                    && p.email
                        .as_ref()
                        .is_none_or(|e| e.len() <= 320 && !e.contains(['\n', '\r'])),
                "invalid manual participant"
            );
        }
        self.profiles.execute("INSERT INTO participant_context VALUES(?1,?2) ON CONFLICT(meeting_id) DO UPDATE SET participants_json=excluded.participants_json",params![meeting,serde_json::to_string(participants)?])?;
        Ok(())
    }
    /// Installs externally validated evidence, never inferred from product fixture scores.
    /// No desktop command installs policies. Evaluation harnesses must supply a frozen policy.
    pub fn install_calibration_policy(
        &mut self,
        id: &str,
        version: &str,
        calibration: &Calibration,
        evidence: &Value,
    ) -> Result<()> {
        ensure!(
            !id.trim().is_empty() && !version.trim().is_empty(),
            "policy identity required"
        );
        ensure!(
            evidence["validation_status"] == "validated"
                && evidence["disjoint_enrollment_calibration_test"] == true
                && evidence["false_accepts"].as_u64().is_some()
                && evidence["unknown_speakers"].as_u64().is_some_and(|n| n > 0),
            "validated disjoint open-set evidence required"
        );
        crate::artifacts::validate_hash(evidence["corpus_sha256"].as_str().unwrap_or(""))?;
        // Exercise policy and embedding-space validation without changing profiles.
        let dimension: i64 = self.profiles.query_row(
            "SELECT dimension FROM embedding_space WHERE id=?1",
            [&calibration.space_id],
            |r| r.get(0),
        )?;
        let mut probe = vec![0.; dimension as usize];
        probe[0] = 1.;
        self.match_voice(&calibration.space_id, &probe, Some(calibration))?;
        let tx = self.profiles.transaction()?;
        tx.execute(
            "UPDATE calibration_policy SET active=0 WHERE space_id=?1",
            [&calibration.space_id],
        )?;
        tx.execute("INSERT INTO calibration_policy(id,version,space_id,calibration_json,evidence_json,active) VALUES(?1,?2,?3,?4,?5,1)",params![id,version,calibration.space_id,serde_json::to_string(calibration)?,serde_json::to_string(evidence)?])?;
        tx.commit()?;
        Ok(())
    }
    pub fn revoke_calibration_policy(&self, id: &str) -> Result<()> {
        ensure!(
            self.profiles
                .execute("UPDATE calibration_policy SET active=0 WHERE id=?1", [id])?
                == 1,
            "policy not found"
        );
        Ok(())
    }
    /// Reads candidates and current policy/profile generation. Never inserts assignments or samples.
    pub fn recognition(&self, job: &str) -> Result<Value> {
        let report = self.processing_report_by_job(job)?;
        let generation: i64 = self.profiles.query_row(
            "SELECT revision FROM profile_revision WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        let mut speakers = Vec::new();
        let mut calibrated = false;
        let mut keys = std::collections::BTreeSet::new();
        for turn in &report.turns {
            if turn.speaker != "unknown" {
                keys.insert((turn.track.clone(), turn.speaker.clone()));
            }
        }
        for (track, speaker) in keys {
            let mut row = json!({"track":track,"speaker":speaker,"state":"unknown","reason":"uncalibrated embedding space","personId":null,"name":null,"policyId":null,"cosineSimilarity":null});
            let mut q=self.profiles.prepare("SELECT space_json,vector_json,provenance_json FROM processed_candidate WHERE job_id=?1 AND speaker=?2 ORDER BY turn_id")?;
            let candidates = q
                .query_map(params![job, speaker], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut decisions = Vec::new();
            let expected_turns = report
                .turns
                .iter()
                .filter(|t| t.track == track && t.speaker == speaker)
                .count();
            for (space, vector, provenance) in candidates {
                let p: Value = serde_json::from_str(&provenance)?;
                if p["track"] != track {
                    continue;
                }
                let space: EmbeddingSpace = serde_json::from_str(&space)?;
                let space_id:Option<String>=self.profiles.query_row("SELECT id FROM embedding_space WHERE model=?1 AND revision=?2 AND model_hash=?3 AND preprocessing=?4 AND dimension=?5",params![space.model,space.revision,space.model_hash,space.preprocessing,space.dimension as i64],|r|r.get(0)).optional()?;
                let Some(space_id) = space_id else {
                    continue;
                };
                let policy:Option<(String,String)>=self.profiles.query_row("SELECT id,calibration_json FROM calibration_policy WHERE space_id=?1 AND active=1",[&space_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
                let Some((policy_id, policy)) = policy else {
                    continue;
                };
                calibrated = true;
                let result = self.match_voice(
                    &space_id,
                    &serde_json::from_str::<Vec<f32>>(&vector)?,
                    Some(&serde_json::from_str(&policy)?),
                )?;
                decisions.push((policy_id, result));
            }
            if !decisions.is_empty() && decisions.len() == expected_turns {
                let first = &decisions[0];
                if let MatchResult::Suggestion {
                    person_id,
                    cosine_similarity,
                    ..
                } = &first.1
                {
                    if decisions.iter().all(|(p, r)| {
                        p == &first.0
                            && matches!(r,MatchResult::Suggestion{person_id:id,..} if id==person_id)
                    }) {
                        let name: String = self.profiles.query_row(
                            "SELECT name FROM person WHERE id=?1",
                            [person_id],
                            |r| r.get(0),
                        )?;
                        row = json!({"track":track,"speaker":speaker,"state":"suggested","reason":"current validated acoustic policy","personId":person_id,"name":name,"policyId":first.0,"cosineSimilarity":cosine_similarity});
                    } else {
                        row["reason"] = json!("ambiguous turn-level acoustic evidence");
                    }
                } else if let MatchResult::Unknown { reason } = &first.1 {
                    row["reason"] = json!(reason);
                }
            }
            speakers.push(row);
        }
        Ok(
            json!({"job":job,"calibrationStatus":if calibrated {"calibrated"}else{"uncalibrated"},"profileGeneration":generation,"speakers":speakers}),
        )
    }
}
