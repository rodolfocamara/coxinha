use crate::store::Store;
use anyhow::{ensure, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize)]
pub struct JobInput {
    pub artifact_sha256: String,
    pub config_sha256: String,
    pub model_sha256: String,
    pub engine_version: String,
}

impl Store {
    pub fn enqueue(&self, meeting: &str, stage: &str, input: &JobInput) -> Result<String> {
        ensure!(
            !stage.is_empty() && !input.engine_version.is_empty(),
            "stage and engine version required"
        );
        for hash in [
            &input.artifact_sha256,
            &input.config_sha256,
            &input.model_sha256,
        ] {
            crate::artifacts::validate_hash(hash)?;
        }
        let key = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(meeting, stage, input))?)
        );
        self.db.execute("INSERT INTO job(id,meeting_id,identity_key,stage,input_json) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(identity_key) DO NOTHING",params![uuid::Uuid::new_v4().to_string(),meeting,key,stage,serde_json::to_string(input)?])?;
        Ok(self
            .db
            .query_row("SELECT id FROM job WHERE identity_key=?1", [key], |r| {
                r.get(0)
            })?)
    }
    pub fn claim(&self, id: &str) -> Result<bool> {
        Ok(self.db.execute("UPDATE job SET state='running', attempts=attempts+1,error=NULL WHERE id=?1 AND state='pending' AND (stage!='local-processing' OR (NOT EXISTS(SELECT 1 FROM job WHERE state='running' AND stage='local-processing') AND NOT EXISTS(SELECT 1 FROM meeting WHERE capture_state='recording')))",[id])?==1)
    }
    pub fn finish_job(&self, id: &str, error: Option<&str>) -> Result<()> {
        ensure!(
            self.db.execute(
                "UPDATE job SET state=?2,error=?3 WHERE id=?1 AND state='running'",
                params![
                    id,
                    if error.is_some() {
                        "failed"
                    } else {
                        "succeeded"
                    },
                    error
                ]
            )? == 1,
            "job is not running"
        );
        Ok(())
    }
    pub fn retry_job(&self, id: &str) -> Result<()> {
        ensure!(
            self.db.execute(
                "UPDATE job SET state='pending' WHERE id=?1 AND state='failed'",
                [id]
            )? == 1,
            "job is not failed"
        );
        Ok(())
    }
    /// Explicit startup action after acquiring the exclusive library lock.
    pub fn recover_jobs(&self) -> Result<usize> {
        Ok(self.db.execute("UPDATE job SET state='pending',error='interrupted before completion' WHERE state='running'",[])?)
    }
    pub fn job_state(&self, id: &str) -> Result<String> {
        Ok(self
            .db
            .query_row("SELECT state FROM job WHERE id=?1", [id], |r| r.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn idempotent_recovery_keeps_human_edits() -> Result<()> {
        let d = tempfile::tempdir()?;
        let s = Store::open(d.path())?;
        let m = s.create_meeting("fixture")?;
        let mut i = JobInput {
            artifact_sha256: "a".repeat(64),
            config_sha256: "b".repeat(64),
            model_sha256: "c".repeat(64),
            engine_version: "v1".into(),
        };
        let j = s.enqueue(&m, "stt", &i)?;
        assert_eq!(j, s.enqueue(&m, "stt", &i)?);
        assert!(s.claim(&j)?);
        assert!(!s.claim(&j)?);
        s.edit(&m, "segment-1", "human correction")?;
        drop(s);
        let s = Store::open(d.path())?;
        assert_eq!(s.recover_jobs()?, 1);
        assert!(s.claim(&j)?);
        s.finish_job(&j, Some("missing model"))?;
        s.retry_job(&j)?;
        assert!(s.claim(&j)?);
        s.finish_job(&j, None)?;
        assert!(!s.claim(&j)?);
        i.engine_version = "v2".into();
        assert_ne!(j, s.enqueue(&m, "stt", &i)?);
        assert_eq!(
            s.latest_edit(&m, "segment-1")?.as_deref(),
            Some("human correction")
        );
        Ok(())
    }
}
