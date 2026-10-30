use super::*;
use crate::identity::SampleProvenance;
use crate::store::Store;
use anyhow::ensure;
use rusqlite::{params, OptionalExtension};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AssignmentView {
    pub id: String,
    pub speaker: String,
    pub track: Option<String>,
    pub person_id: Option<String>,
    pub state: String,
    pub name: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcessingReport {
    pub job: String,
    pub segments: Vec<TranscriptSegment>,
    pub turns: Vec<SpeakerTurn>,
    pub warnings: Vec<String>,
    pub assignments: Vec<AssignmentView>,
    pub corrections: BTreeMap<String, String>,
}
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
        let job:String=self.db.query_row("SELECT j.id FROM job j JOIN processing_run r ON r.job_id=j.id WHERE j.meeting_id=?1 AND j.state='succeeded' ORDER BY j.rowid DESC LIMIT 1",[meeting],|r|r.get(0))?;
        self.processing_report_by_job(&job)
    }
    pub fn processing_report_by_job(&self, job: &str) -> Result<ProcessingReport> {
        let (meeting,json):(String,String)=self.db.query_row("SELECT j.meeting_id,r.result_json FROM job j JOIN processing_run r ON r.job_id=j.id WHERE j.id=?1 AND j.state='succeeded'",[job],|r|Ok((r.get(0)?,r.get(1)?)))?;
        let job = job.to_owned();
        let result: ProcessingResult = serde_json::from_str(&json)?;
        let mut corrections = BTreeMap::new();
        for segment in &result.segments {
            if let Some(text) = self.latest_edit(&meeting, &format!("{job}:{}", segment.id))? {
                corrections.insert(segment.id.clone(), text);
            }
        }
        let mut q=self.profiles.prepare("SELECT a.id,a.speaker,a.person_id,a.state,p.name FROM assignment a LEFT JOIN person p ON p.id=a.person_id WHERE a.meeting_id=?1 AND a.speaker LIKE ?2")?;
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
    pub fn confirm_processed_speaker(
        &mut self,
        job: &str,
        speaker: &str,
        person: &str,
        origin: &str,
    ) -> Result<String> {
        self.confirm_processed_track_speaker(job, speaker, None, person, origin)
    }
    pub fn confirm_processed_track_speaker(
        &mut self,
        job: &str,
        speaker: &str,
        track: Option<&str>,
        person: &str,
        origin: &str,
    ) -> Result<String> {
        ensure!(
            speaker != "unknown" && !speaker.trim().is_empty(),
            "ambiguous unknown speaker cannot be confirmed"
        );
        let meeting: String = self.db.query_row(
            "SELECT meeting_id FROM job WHERE id=?1 AND state='succeeded'",
            [job],
            |r| r.get(0),
        )?;
        let json: String = self.db.query_row(
            "SELECT result_json FROM processing_run WHERE job_id=?1",
            [job],
            |r| r.get(0),
        )?;
        let result: ProcessingResult = serde_json::from_str(&json)?;
        ensure!(
            result.turns.iter().any(|t| t.speaker == speaker),
            "speaker absent from this processing run"
        );
        let tracks: std::collections::BTreeSet<_> = result
            .turns
            .iter()
            .filter(|t| t.speaker == speaker && track.is_none_or(|track| t.track == track))
            .map(|t| t.track.as_str())
            .collect();
        ensure!(
            tracks.len() == 1,
            "speaker label crosses tracks; explicit track required"
        );
        let scoped = format!("{job}:{}:{speaker}", tracks.first().unwrap());
        let existing:Option<String>=self.profiles.query_row("SELECT id FROM assignment WHERE meeting_id=?1 AND speaker=?2 ORDER BY rowid DESC LIMIT 1",params![meeting,scoped],|r|r.get(0)).optional()?;
        let id = if let Some(id) = existing {
            id
        } else {
            self.suggest_assignment(&meeting, &scoped, None)?
        };
        self.decide_assignment(&id, Some(person), "confirmed", origin)?;
        Ok(id)
    }
    pub fn enroll_processed_speaker(
        &mut self,
        assignment: &str,
        job: &str,
        speaker: &str,
    ) -> Result<Vec<String>> {
        ensure!(
            speaker != "unknown",
            "ambiguous unknown speaker cannot be enrolled"
        );
        let meeting: String = self.db.query_row(
            "SELECT meeting_id FROM job WHERE id=?1 AND state='succeeded'",
            [job],
            |r| r.get(0),
        )?;
        let scoped: String = self.profiles.query_row(
            "SELECT speaker FROM assignment WHERE id=?1",
            [assignment],
            |r| r.get(0),
        )?;
        let prefix = format!("{job}:");
        let track = scoped
            .strip_prefix(&prefix)
            .and_then(|s| s.strip_suffix(&format!(":{speaker}")))
            .ok_or_else(|| anyhow::anyhow!("assignment source scope mismatch"))?
            .to_string();
        let report = self.processing_report_by_job(job)?;
        let turns: Vec<_> = report
            .turns
            .iter()
            .filter(|t| t.track == track && t.speaker == speaker)
            .collect();
        ensure!(!turns.is_empty(), "speaker absent from assigned track");
        ensure!(
            turns
                .iter()
                .all(|turn| !report.turns.iter().any(|other| other.track == track
                    && other.speaker != speaker
                    && other.start_ms < turn.end_ms
                    && other.end_ms > turn.start_ms)),
            "overlapping or unknown speech cannot be enrolled"
        );
        let valid: i64 = self.profiles.query_row(
            "SELECT count(*) FROM assignment WHERE id=?1 AND speaker=?2 AND state='confirmed' AND meeting_id=?3",
            params![assignment, scoped, meeting],
            |r| r.get(0),
        )?;
        ensure!(
            valid == 1,
            "candidate requires matching confirmed assignment"
        );
        let candidates = {
            let mut q=self.profiles.prepare("SELECT space_json,vector_json,provenance_json FROM processed_candidate WHERE job_id=?1 AND speaker=?2 ORDER BY turn_id")?;
            let rows = q.query_map(params![job, speaker], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let verified = self.verify_enrollment_source(&meeting)?;
        let mut samples = Vec::new();
        for (s, v, p) in candidates {
            let provenance: SampleProvenance = serde_json::from_str(&p)?;
            if provenance.track != track {
                continue;
            }
            let enrolled = (|| -> Result<String> {
                let space: EmbeddingSpace = serde_json::from_str(&s)?;
                let id = self.register_space(&space)?;
                self.enroll_verified(
                    assignment,
                    &id,
                    &serde_json::from_str::<Vec<f32>>(&v)?,
                    &provenance,
                    &verified,
                )
            })();
            match enrolled {
                Ok(id) => samples.push(id),
                Err(error) => {
                    for id in &samples {
                        self.revoke_sample(id)?;
                    }
                    return Err(error);
                }
            }
        }
        if let Err(error) = self.recheck_enrollment_source(&verified) {
            for id in &samples {
                self.revoke_sample(id)?;
            }
            return Err(error);
        }
        ensure!(
            !samples.is_empty(),
            "no eligible voice samples for enrollment; human confirmation remains valid"
        );
        Ok(samples)
    }
}
