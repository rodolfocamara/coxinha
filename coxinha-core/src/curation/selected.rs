use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedEnrollment {
    pub job: String,
    pub track: String,
    pub speaker: String,
    pub assignment_id: String,
    pub person_id: String,
    pub expected_assignment_revision: i64,
    pub turn_ids: Vec<String>,
    pub human_origin: String,
}
fn validate_origin(origin: &str) -> Result<()> {
    ensure!(
        !origin.trim().is_empty() && origin.len() <= 1000 && !origin.chars().any(char::is_control),
        "valid explicit human origin required"
    );
    Ok(())
}
impl Store {
    pub fn enroll_selected_turns(&self, selection: &SelectedEnrollment) -> Result<Value> {
        self.enroll_selected_checked(selection, || Ok(()))
    }
    pub(super) fn enroll_selected_checked(
        &self,
        s: &SelectedEnrollment,
        after_insert: impl FnOnce() -> Result<()>,
    ) -> Result<Value> {
        validate_origin(&s.human_origin)?;
        ensure!(
            !s.turn_ids.is_empty() && s.turn_ids.len() <= MAX_SELECTED,
            "select 1 to 128 unique turns"
        );
        let ids: BTreeSet<_> = s.turn_ids.iter().collect();
        ensure!(
            ids.len() == s.turn_ids.len() && ids.iter().all(|id| !id.is_empty()),
            "duplicate or empty selected turn ID"
        );
        let tx = Transaction::new_unchecked(&self.profiles, TransactionBehavior::Immediate)?;
        let (meeting, report, manifest) = bounded_report(self, &s.job)?;
        let scope = format!("{}:{}:{}", s.job, s.track, s.speaker);
        let valid: i64 = self.profiles.query_row("SELECT count(*) FROM assignment WHERE id=?1 AND meeting_id=?2 AND speaker=?3 AND person_id=?4 AND state='confirmed' AND revision=?5 AND human_origin IS NOT NULL",params![s.assignment_id,meeting,scope,s.person_id,s.expected_assignment_revision], |r|r.get(0))?;
        ensure!(
            valid == 1,
            "stale or mismatched confirmed assignment/person/revision/scope"
        );
        let candidates = candidates::load_candidates(self, &s.job, &meeting, &report, &manifest)?;
        let mut selected = Vec::new();
        for id in ids {
            let c = candidates
                .iter()
                .find(|c| &c.turn.id == id)
                .ok_or_else(|| anyhow::anyhow!("selected turn absent from job"))?;
            ensure!(
                c.turn.track == s.track && c.turn.speaker == s.speaker,
                "selected turn source scope mismatch"
            );
            ensure!(
                c.eligible(),
                "selected turn is structurally ineligible: {}",
                c.reasons.join(",")
            );
            selected.push(c);
        }
        let (existing, mut projected_bytes) = active_budget(self)?;
        ensure!(
            existing
                .checked_add(selected.len())
                .is_some_and(|n| n <= MAX_INVENTORY),
            CurationError::Capacity
        );
        let verified = self.verify_enrollment_source(&meeting)?;
        ensure!(
            crate::processing::hash_json(&verified.manifest)?
                == crate::processing::hash_json(&manifest)?,
            "source changed after candidate validation"
        );
        let mut sample_ids = Vec::new();
        for c in selected {
            let space = self.register_space(c.space.as_ref().unwrap())?;
            let p = c.provenance.as_ref().unwrap();
            let duplicate: i64 = tx.query_row("SELECT count(*) FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.space_id=?1 AND s.revoked=0 AND a.state='confirmed' AND a.person_id=s.person_id AND a.revision=s.assignment_revision AND json_extract(s.provenance_json,'$.audio_sha256')=?2 AND json_extract(s.provenance_json,'$.track')=?3 AND json_extract(s.provenance_json,'$.start_ms')=?4 AND json_extract(s.provenance_json,'$.end_ms')=?5",params![space,p.audio_sha256,p.track,i64::try_from(p.start_ms)?,i64::try_from(p.end_ms)?],|r|r.get(0))?;
            ensure!(
                duplicate == 0,
                "source interval already enrolled in this embedding space"
            );
            let id = uuid::Uuid::new_v4().to_string();
            let mut provenance = serde_json::to_value(p)?;
            provenance["selectedEnrollment"] = json!({"sampleId":id,"job":s.job,"turnId":c.turn.id,"humanOrigin":s.human_origin,"createdAt":tx.query_row("SELECT CURRENT_TIMESTAMP",[],|r|r.get::<_,String>(0))?});
            let vector_json = serde_json::to_string(&c.vector)?;
            let provenance_json = serde_json::to_string(&provenance)?;
            projected_bytes = projected_bytes
                .checked_add(vector_json.len())
                .and_then(|n| n.checked_add(provenance_json.len()))
                .ok_or(CurationError::Capacity)?;
            ensure!(projected_bytes <= 32 * 1024 * 1024, CurationError::Capacity);
            tx.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,s.assignment_id,s.expected_assignment_revision,s.person_id,space,vector_json,provenance_json])?;
            sample_ids.push(id);
        }
        after_insert()?;
        self.recheck_enrollment_source(&verified)?;
        tx.execute(
            "UPDATE profile_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        let result = json!({"sampleIds":sample_ids,"profileGeneration":generation(self)?});
        tx.commit()?;
        Ok(result)
    }
    /// Extensible JSON preserves fields unknown to old SampleProvenance readers.
    pub fn revoke_voice_sample(&self, person: &str, sample: &str, origin: &str) -> Result<()> {
        validate_origin(origin)?;
        let tx = Transaction::new_unchecked(&self.profiles, TransactionBehavior::Immediate)?;
        let raw: String = tx.query_row(
            "SELECT provenance_json FROM voice_sample WHERE id=?1 AND person_id=?2",
            params![sample, person],
            |r| r.get(0),
        )?;
        let parsed = serde_json::from_str::<Value>(&raw).ok();
        let usable = parsed
            .as_ref()
            .and_then(Value::as_object)
            .is_some_and(|o| o.get("curationRevocations").is_none_or(Value::is_array));
        let mut p = if usable {
            parsed.unwrap()
        } else {
            json!({"retainedInvalidProvenance":raw})
        };
        let events = p
            .as_object_mut()
            .unwrap()
            .entry("curationRevocations")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .unwrap();
        let now: String = tx.query_row("SELECT CURRENT_TIMESTAMP", [], |r| r.get(0))?;
        events.push(json!({"createdAt":now,"humanOrigin":origin}));
        tx.execute(
            "UPDATE voice_sample SET revoked=1,provenance_json=?2 WHERE id=?1",
            params![sample, serde_json::to_string(&p)?],
        )?;
        tx.execute(
            "UPDATE profile_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
}
