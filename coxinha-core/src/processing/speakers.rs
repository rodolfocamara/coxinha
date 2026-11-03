use super::*;
use crate::identity::SampleProvenance;
use crate::store::Store;
use anyhow::ensure;
use rusqlite::{params, OptionalExtension};

impl Store {
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
        let id = self.processed_assignment(job, speaker, track)?;
        self.decide_assignment(&id, Some(person), "confirmed", origin)?;
        Ok(id)
    }
    /// "Not a participant" (spec 0120 P6): rejected without a person, never
    /// remembered; revoking the assignment undoes it.
    pub fn reject_processed_track_speaker(
        &mut self,
        job: &str,
        speaker: &str,
        track: Option<&str>,
        origin: &str,
    ) -> Result<String> {
        let id = self.processed_assignment(job, speaker, track)?;
        self.decide_assignment(&id, None, "rejected", origin)?;
        Ok(id)
    }
    fn processed_assignment(
        &mut self,
        job: &str,
        speaker: &str,
        track: Option<&str>,
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
        match existing {
            Some(id) => Ok(id),
            None => self.suggest_assignment(&meeting, &scoped, None),
        }
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
