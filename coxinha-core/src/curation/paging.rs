use super::*;

/// Per-worker lifetime, not a cursor registry. Recreating it invalidates old tokens.
pub struct InventoryPager {
    epoch: String,
}
impl Default for InventoryPager {
    fn default() -> Self {
        Self {
            epoch: uuid::Uuid::new_v4().to_string(),
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    version: u8,
    operation: String,
    person: Option<String>,
    generation: i64,
    metadata: String,
    upper: i64,
    after: i64,
}
impl Cursor {
    fn encode(&self) -> Result<String> {
        Ok(serde_json::to_vec(self)?
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect())
    }
    fn decode(raw: &str) -> Result<Self> {
        ensure!(
            raw.len() <= 2048 && raw.len().is_multiple_of(2),
            CurationError::Cursor
        );
        let bytes = (0..raw.len())
            .step_by(2)
            .map(|i| {
                u8::from_str_radix(raw.get(i..i + 2).ok_or(CurationError::Cursor)?, 16)
                    .map_err(|_| CurationError::Cursor)
            })
            .collect::<std::result::Result<Vec<_>, _>>()?;
        serde_json::from_slice(&bytes).map_err(|_| CurationError::Cursor.into())
    }
}
impl InventoryPager {
    fn cursor(
        &self,
        store: &Store,
        raw: Option<&str>,
        operation: &str,
        person: Option<&str>,
        upper: i64,
    ) -> Result<Cursor> {
        let generation = generation(store)?;
        let data_version: i64 = store
            .profiles
            .pragma_query_value(None, "data_version", |r| r.get(0))?;
        let metadata = crate::processing::hash_json(&(
            &self.epoch,
            store.profiles.total_changes(),
            data_version,
        ))?;
        if let Some(raw) = raw {
            let cursor = Cursor::decode(raw)?;
            ensure!(
                cursor.version == 2
                    && cursor.operation == operation
                    && cursor.person.as_deref() == person
                    && cursor.generation >= 0
                    && cursor.after > 0
                    && cursor.after < cursor.upper
                    && cursor.upper <= upper
                    && cursor.metadata.len() == 64,
                CurationError::Cursor
            );
            ensure!(
                cursor.generation == generation && cursor.metadata == metadata,
                CurationError::Refresh
            );
            Ok(cursor)
        } else {
            Ok(Cursor {
                version: 2,
                operation: operation.into(),
                person: person.map(str::to_owned),
                generation,
                metadata,
                upper,
                after: 0,
            })
        }
    }
    pub fn profiles_page(
        &self,
        store: &Store,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Value> {
        let limit = limit.unwrap_or(25);
        ensure!((1..=50).contains(&limit), CurationError::Cursor);
        let _snapshot = snapshot(store)?;
        let upper: i64 =
            store
                .profiles
                .query_row("SELECT coalesce(max(rowid),0) FROM person", [], |r| {
                    r.get(0)
                })?;
        let mut token = self.cursor(store, cursor, "profiles", None, upper)?;
        let mut q=store.profiles.prepare("SELECT rowid,id,length(CAST(name AS BLOB)),CASE WHEN length(CAST(name AS BLOB))<=1048576 THEN name END FROM person WHERE rowid>?1 AND rowid<=?2 ORDER BY rowid LIMIT ?3")?;
        let mut rows = q.query(params![token.after, token.upper, limit])?;
        let mut profiles = Vec::new();
        while let Some(row) = rows.next()? {
            token.after = row.get(0)?;
            let bytes: i64 = row.get(2)?;
            ensure!(bytes <= 1024 * 1024, CurationError::InventoryRow);
            let id: String = row.get(1)?;
            let (active, meetings) = active_samples(store, &id)?;
            profiles.push(json!({"personId":id,"name":row.get::<_,String>(3)?,"activeSamples":active,"sampleMeetings":meetings}));
        }
        let scanned = profiles.len();
        let next = if scanned > 0 && token.after < token.upper {
            Some(token.encode()?)
        } else {
            None
        };
        Ok(
            json!({"profileGeneration":token.generation,"profiles":profiles,"nextCursor":next,"scannedRows":scanned}),
        )
    }
    pub fn samples_page(
        &self,
        store: &Store,
        person: &str,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Value> {
        let limit = limit.unwrap_or(50);
        ensure!((1..=100).contains(&limit), CurationError::Cursor);
        let _snapshot = snapshot(store)?;
        let _: String =
            store
                .profiles
                .query_row("SELECT id FROM person WHERE id=?1", [person], |r| r.get(0))?;
        let upper: i64 = store.profiles.query_row(
            "SELECT coalesce(max(rowid),0) FROM voice_sample",
            [],
            |r| r.get(0),
        )?;
        let mut token = self.cursor(store, cursor, "samples", Some(person), upper)?;
        let mut q=store.profiles.prepare("SELECT rowid,id,person_id,length(CAST(provenance_json AS BLOB)) FROM voice_sample WHERE rowid>?1 AND rowid<=?2 ORDER BY rowid LIMIT 4096")?;
        let mut rows = q.query(params![token.after, token.upper])?;
        let mut samples = Vec::new();
        let mut scanned = 0;
        while samples.len() < limit as usize {
            let Some(row) = rows.next()? else {
                if scanned < 4096 {
                    token.after = token.upper;
                }
                break;
            };
            scanned += 1;
            token.after = row.get(0)?;
            if row.get::<_, String>(2)? == person {
                ensure!(
                    row.get::<_, i64>(3)? <= 1024 * 1024,
                    CurationError::InventoryRow
                );
                samples.push(
                    sample_projection(store, &row.get::<_, String>(1)?, person)
                        .map_err(|_| CurationError::InventoryRow)?,
                );
            }
        }
        let next = if token.after < token.upper {
            Some(token.encode()?)
        } else {
            None
        };
        Ok(
            json!({"profileGeneration":token.generation,"personId":person,"samples":samples,"nextCursor":next,"scannedRows":scanned}),
        )
    }
}
/// True per-person totals for the people list (spec 0096 decision): bounded by
/// the page size, read in the same snapshot, and counted with the same rule as
/// `sample_projection`'s "active" state. Malformed provenance never blocks it.
fn active_samples(store: &Store, person: &str) -> Result<(i64, i64)> {
    Ok(store.profiles.query_row(
        "SELECT count(*), count(DISTINCT CASE WHEN json_valid(s.provenance_json) THEN json_extract(s.provenance_json,'$.meeting') END) FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.person_id=?1 AND s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=?1",
        [person],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}
fn sample_projection(store: &Store, id: &str, person: &str) -> Result<Value> {
    let mut q=store.profiles.prepare("SELECT s.id,s.assignment_id,s.assignment_revision,a.revision,s.revoked,a.state,a.person_id,s.space_id,s.provenance_json,s.created_at,e.model,e.revision,e.model_hash,e.preprocessing,e.dimension FROM voice_sample s LEFT JOIN assignment a ON a.id=s.assignment_id LEFT JOIN embedding_space e ON e.id=s.space_id WHERE s.id=?1 AND s.person_id=?2")?;
    let row = q.query_row(params![id, person], |r| {
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
    })?;
    let (
        id,
        assignment,
        revision,
        current,
        revoked,
        state,
        assigned,
        space_id,
        raw,
        created,
        space,
    ) = row;
    let p: SampleProvenance = serde_json::from_str(&raw)?;
    p.validate()?;
    space.validate()?;
    let value: Value = serde_json::from_str(&raw)?;
    let state = if revoked {
        "revoked"
    } else if state == "confirmed" && revision == current && assigned.as_deref() == Some(person) {
        "active"
    } else {
        "invalidated"
    };
    Ok(
        json!({"sampleId":id,"assignmentId":assignment,"assignmentRevision":revision,"currentAssignmentRevision":current,"state":state,"spaceId":space_id,"space":space,"meetingId":p.meeting,"track":p.track,"startMs":p.start_ms,"endMs":p.end_ms,"createdAt":created,"revokedAt":value["curationRevocations"].as_array().and_then(|events|events.last()).and_then(|event|event.get("createdAt")).and_then(Value::as_str)}),
    )
}
