use super::*;
use crate::identity::SampleProvenance;
use crate::store::Store;
use anyhow::ensure;
use rusqlite::params;
impl Store {
    pub fn list_people(&self) -> Result<Vec<serde_json::Value>> {
        let mut q = self
            .profiles
            .prepare("SELECT id,name FROM person ORDER BY name")?;
        let rows = q.query_map([], |r| {
            Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?}))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
    /// `engine_version` of each local-processing job of the meeting; empty
    /// when a job has no recorded run.
    pub fn processing_engine_versions(&self, meeting: &str) -> Result<Vec<String>> {
        let mut q = self.db.prepare("SELECT r.config_json FROM job j LEFT JOIN processing_run r ON r.job_id=j.id WHERE j.meeting_id=?1 AND j.stage='local-processing'")?;
        let rows = q.query_map([meeting], |r| r.get::<_, Option<String>>(0))?;
        let mut versions = Vec::new();
        for config in rows {
            let version = config?
                .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                .and_then(|c| c["engine_version"].as_str().map(str::to_owned));
            versions.push(version.unwrap_or_default());
        }
        Ok(versions)
    }
    pub fn meeting_processing_jobs(&self, meeting: &str) -> Result<Vec<serde_json::Value>> {
        let mut q=self.db.prepare("SELECT id,state,attempts,error FROM job WHERE meeting_id=?1 AND stage='local-processing' ORDER BY rowid DESC")?;
        let rows=q.query_map([meeting],|r|Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"state":r.get::<_,String>(1)?,"attempts":r.get::<_,i64>(2)?,"error":r.get::<_,Option<String>>(3)?})))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn commit_processing(
        &mut self,
        input: &PreparedProcessing,
        mut result: ProcessingResult,
    ) -> Result<()> {
        ensure!(
            self.job_state(&input.job)? == "running",
            "job is not running"
        );
        let stored:(String,String)=self.db.query_row("SELECT j.meeting_id,r.config_json FROM job j JOIN processing_run r ON r.job_id=j.id WHERE j.id=?1",[&input.job],|r|Ok((r.get(0)?,r.get(1)?)))?;
        ensure!(
            stored.0 == input.meeting && stored.1 == serde_json::to_string(&input.config)?,
            "prepared job mismatch"
        );
        let manifest: crate::capture::CaptureManifest =
            serde_json::from_reader(std::fs::File::open(
                self.root
                    .join("raw")
                    .join(&input.meeting)
                    .join("manifest.json"),
            )?)?;
        super::prepare::validate_descriptors(&self.root, input, &manifest)?;
        let mut ids = std::collections::HashSet::new();
        for (id, track, start, end) in result
            .segments
            .iter()
            .map(|s| (&s.id, &s.track, s.start_ms, s.end_ms))
            .chain(
                result
                    .turns
                    .iter()
                    .map(|s| (&s.id, &s.track, s.start_ms, s.end_ms)),
            )
        {
            ensure!(
                !id.is_empty() && ids.insert(id.clone()),
                "duplicate or empty result id"
            );
            let t = input
                .tracks
                .iter()
                .find(|t| t.track == *track)
                .ok_or_else(|| anyhow::anyhow!("invalid source track"))?;
            ensure!(
                end > start && end as u128 * t.sample_rate as u128 <= t.frames as u128 * 1000,
                "result interval exceeds track"
            );
        }
        let delivery = serde_json::to_string(&result)?;
        self.check_pending_delivery(input, &delivery)?;
        let tx = self.profiles.transaction()?;
        tx.execute(
            "DELETE FROM processed_candidate WHERE job_id=?1",
            [&input.job],
        )?;
        for turn in &mut result.turns {
            ensure!(
                !turn.speaker.trim().is_empty(),
                "anonymous speaker required"
            );
            match (turn.embedding.take(), turn.space.take()) {
                (Some(vector), Some(space)) => {
                    ensure!(
                        vector.len() == space.dimension
                            && vector.iter().all(|v| v.is_finite())
                            && vector.iter().any(|v| *v != 0.),
                        "invalid embedding"
                    );
                    crate::artifacts::validate_hash(&space.model_hash)?;
                    ensure!(
                        !space.model.is_empty()
                            && !space.revision.is_empty()
                            && !space.preprocessing.is_empty(),
                        "embedding provenance required"
                    );
                    let t = input.tracks.iter().find(|t| t.track == turn.track).unwrap();
                    let p = SampleProvenance {
                        meeting: input.meeting.clone(),
                        track: turn.track.clone(),
                        start_ms: turn.start_ms,
                        end_ms: turn.end_ms,
                        audio_sha256: t.audio_sha256.clone(),
                        device: manifest.tracks[input
                            .tracks
                            .iter()
                            .position(|x| x.track == t.track)
                            .unwrap()]
                        .source
                        .clone(),
                        quality_note: "experimental local diarization; human confirmation required"
                            .into(),
                    };
                    tx.execute("INSERT INTO processed_candidate VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(job_id,turn_id) DO NOTHING",params![input.job,turn.speaker,turn.id,serde_json::to_string(&space)?,serde_json::to_string(&vector)?,serde_json::to_string(&p)?])?;
                }
                (None, None) => {}
                _ => anyhow::bail!("embedding and space must be paired"),
            }
        }
        tx.execute("INSERT INTO processing_publication(job_id,meeting_id,input_json,result_json) VALUES(?1,?2,?3,?4) ON CONFLICT(job_id) DO NOTHING", params![input.job, input.meeting, serde_json::to_string(input)?, delivery])?;
        tx.commit()?;
        super::publication::checkpoint("private")?;
        // A public file is written only after all private candidates pass validation.
        let public = serde_json::to_string(&result)?;
        self.publish_processing_artifact(
            input,
            &super::publication::public_bytes(input, &result)?,
        )?;
        let tx = self.db.transaction()?;
        tx.execute(
            "UPDATE processing_run SET result_json=?2 WHERE job_id=?1",
            params![input.job, public],
        )?;
        tx.execute(
            "UPDATE job SET state='succeeded',error=NULL WHERE id=?1 AND state='running'",
            [&input.job],
        )?;
        tx.commit()?;
        super::publication::checkpoint("public")?;
        self.profiles.execute(
            "DELETE FROM processing_publication WHERE job_id=?1",
            [&input.job],
        )?;
        Ok(())
    }
    pub fn processing_report(&self, meeting: &str) -> Result<ProcessingReport> {
        latest_report(&self.db, &self.profiles, meeting)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows.into())
    }
    pub fn processing_report_by_job(&self, job: &str) -> Result<ProcessingReport> {
        report_for_job(&self.db, &self.profiles, job)
    }
}
