use super::*;

impl Store {
    pub fn person_samples(&self, person: &str) -> Result<Value> {
        let _snapshot = snapshot(self)?;
        legacy_sample_budget(self)?;
        self.person_samples_in_snapshot(person)
    }
    fn person_samples_in_snapshot(&self, person: &str) -> Result<Value> {
        let _: String =
            self.profiles
                .query_row("SELECT id FROM person WHERE id=?1", [person], |r| r.get(0))?;
        let mut q = self.profiles.prepare("SELECT s.id,s.assignment_id,s.assignment_revision,a.revision,s.revoked,a.state,a.person_id,s.space_id,s.provenance_json,s.created_at,e.model,e.revision,e.model_hash,e.preprocessing,e.dimension FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id JOIN embedding_space e ON e.id=s.space_id WHERE s.person_id=?1 ORDER BY s.rowid LIMIT 4097")?;
        let rows = q
            .query_map([person], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, bool>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                    space_json(r, 10)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ensure!(
            rows.len() <= MAX_INVENTORY,
            "person sample inventory limit exceeded"
        );
        let mut samples = Vec::new();
        for (
            id,
            assignment,
            revision,
            current,
            revoked,
            state,
            assigned,
            space_id,
            provenance,
            created,
            space,
        ) in rows
        {
            let p: SampleProvenance = serde_json::from_str(&provenance)?;
            p.validate()?;
            let value: Value = serde_json::from_str(&provenance)?;
            let status = if revoked {
                "revoked"
            } else if state == "confirmed"
                && revision == current
                && assigned.as_deref() == Some(person)
            {
                "active"
            } else {
                "invalidated"
            };
            samples.push(json!({"sampleId":id,"assignmentId":assignment,"assignmentRevision":revision,"currentAssignmentRevision":current,"state":status,"spaceId":space_id,"space":space,"meetingId":p.meeting,"track":p.track,"startMs":p.start_ms,"endMs":p.end_ms,"createdAt":created,"revokedAt":value["curationRevocations"].as_array().and_then(|events|events.last()).and_then(|event|event.get("createdAt")).and_then(Value::as_str)}));
        }
        Ok(json!({"profileGeneration":generation(self)?,"personId":person,"samples":samples}))
    }
    pub fn voice_profiles(&self) -> Result<Value> {
        let _snapshot = snapshot(self)?;
        legacy_sample_budget(self)?;
        let mut q = self
            .profiles
            .prepare("SELECT id,name FROM person ORDER BY name,id LIMIT 4097")?;
        let people = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ensure!(
            people.len() <= MAX_INVENTORY,
            "profile inventory limit exceeded"
        );
        let count: i64 = self
            .profiles
            .query_row("SELECT count(*) FROM voice_sample", [], |r| r.get(0))?;
        ensure!(
            count <= MAX_INVENTORY as i64,
            "sample inventory limit exceeded"
        );
        let mut profiles = Vec::new();
        for (person, name) in people {
            // The outer snapshot is retained; avoid opening a nested transaction.
            let samples = self.person_samples_in_snapshot(&person)?;
            let mut spaces: BTreeMap<String, Value> = BTreeMap::new();
            let mut revoked = 0;
            let mut invalidated = 0;
            for sample in samples["samples"].as_array().unwrap() {
                match sample["state"].as_str() {
                    Some("revoked") => revoked += 1,
                    Some("invalidated") => invalidated += 1,
                    Some("active") => {
                        let entry=spaces.entry(sample["spaceId"].as_str().unwrap().into()).or_insert_with(||json!({"spaceId":sample["spaceId"],"space":sample["space"],"activeCount":0,"activeDurationMs":0}));
                        entry["activeCount"] = json!(entry["activeCount"].as_u64().unwrap() + 1);
                        entry["activeDurationMs"] = json!(entry["activeDurationMs"]
                            .as_u64()
                            .unwrap()
                            .checked_add(
                                sample["endMs"].as_u64().unwrap()
                                    - sample["startMs"].as_u64().unwrap()
                            )
                            .ok_or_else(|| anyhow::anyhow!("sample duration sum overflow"))?);
                    }
                    _ => {}
                }
            }
            profiles.push(json!({"personId":person,"name":name,"spaces":spaces.into_values().collect::<Vec<_>>(),"revokedCount":revoked,"invalidatedCount":invalidated}));
        }
        Ok(json!({"profileGeneration":generation(self)?,"profiles":profiles}))
    }
}
