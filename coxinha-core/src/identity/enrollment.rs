use super::*;
pub(crate) struct VerifiedEnrollmentSource {
    pub(crate) manifest: crate::capture::CaptureManifest,
    root: std::path::PathBuf,
}
impl Store {
    pub fn enroll(
        &mut self,
        assignment: &str,
        space: &str,
        vector: &[f32],
        provenance: &SampleProvenance,
    ) -> Result<String> {
        provenance.validate()?;
        let verified = self.verify_enrollment_source(&provenance.meeting)?;
        self.enroll_verified(assignment, space, vector, provenance, &verified)
    }
    pub(crate) fn verify_enrollment_source(
        &self,
        meeting: &str,
    ) -> Result<VerifiedEnrollmentSource> {
        uuid::Uuid::parse_str(meeting)?;
        let manifest: crate::capture::CaptureManifest = serde_json::from_reader(
            std::fs::File::open(self.root.join("raw").join(meeting).join("manifest.json"))?,
        )?;
        ensure!(
            manifest.meeting == meeting,
            "sample source meeting mismatch"
        );
        manifest.verified_tracks(&self.root)?;
        Ok(VerifiedEnrollmentSource {
            manifest,
            root: self.root.clone(),
        })
    }
    pub(crate) fn recheck_enrollment_source(
        &self,
        source: &VerifiedEnrollmentSource,
    ) -> Result<()> {
        let current = self.verify_enrollment_source(&source.manifest.meeting)?;
        ensure!(
            serde_json::to_string(&current.manifest)? == serde_json::to_string(&source.manifest)?,
            "sample source manifest changed during enrollment"
        );
        Ok(())
    }
    pub(crate) fn enroll_verified(
        &mut self,
        assignment: &str,
        space: &str,
        vector: &[f32],
        provenance: &SampleProvenance,
        verified: &VerifiedEnrollmentSource,
    ) -> Result<String> {
        provenance.validate()?;
        ensure!(
            verified.root == self.root,
            "enrollment verification belongs to another library"
        );
        let manifest = &verified.manifest;
        let (person,revision,meeting):(String,i64,String)=self.profiles.query_row("SELECT person_id,revision,meeting_id FROM assignment WHERE id=?1 AND state='confirmed' AND human_origin IS NOT NULL",[assignment],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        ensure!(
            meeting == provenance.meeting && manifest.meeting == meeting,
            "sample must belong to the confirmed meeting"
        );
        let i = (0..manifest.tracks.len())
            .find(|i| manifest.track_id(*i).ok() == Some(provenance.track.as_str()))
            .ok_or_else(|| anyhow::anyhow!("source track absent"))?;
        let track = &manifest.tracks[i];
        ensure!(
            track.sha256.as_deref() == Some(provenance.audio_sha256.as_str()),
            "sample source checksum mismatch"
        );
        ensure!(
            provenance.end_ms as u128 * manifest.sample_rate as u128 <= track.frames as u128 * 1000,
            "sample interval exceeds raw track"
        );
        let dimension: usize = self
            .profiles
            .query_row(
                "SELECT dimension FROM embedding_space WHERE id=?1",
                [space],
                |r| r.get::<_, i64>(0),
            )?
            .try_into()?;
        vector_norm(vector, dimension)?;
        let duplicate:i64=self.profiles.query_row("SELECT count(*) FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.space_id=?1 AND s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND json_extract(s.provenance_json,'$.audio_sha256')=?2 AND json_extract(s.provenance_json,'$.track')=?3 AND json_extract(s.provenance_json,'$.start_ms')=?4 AND json_extract(s.provenance_json,'$.end_ms')=?5",params![space,provenance.audio_sha256,provenance.track,i64::try_from(provenance.start_ms)?,i64::try_from(provenance.end_ms)?],|r|r.get(0))?;
        ensure!(
            duplicate == 0,
            "source interval already enrolled in this embedding space"
        );
        let id = uuid::Uuid::new_v4().to_string();
        let tx = self.profiles.transaction()?;
        tx.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,assignment,revision,person,space,serde_json::to_string(vector)?,serde_json::to_string(provenance)?])?;
        tx.execute(
            "UPDATE profile_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.commit()?;
        Ok(id)
    }
}
