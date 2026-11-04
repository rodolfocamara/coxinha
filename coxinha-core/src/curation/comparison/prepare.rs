use super::*;

pub(super) fn prepare(store: &Store, job: &str) -> Result<PreparedComparison> {
    let _snapshot = snapshot(store)?;
    active_budget(store)?;
    let (meeting, report, manifest) = bounded_report(store, job)?;
    let hashes = manifest
        .tracks
        .iter()
        .filter_map(|t| t.sha256.clone())
        .collect();
    let candidates =
        super::super::candidates::load_candidates(store, job, &meeting, &report, &manifest)?;
    let mut groups: Groups = BTreeMap::new();
    let mut spaces = BTreeMap::new();
    for c in candidates {
        if c.turn.speaker == "unknown" {
            continue;
        }
        let grouped = groups.entry((c.turn.track, c.turn.speaker)).or_default();
        if c.reasons.iter().any(|r| *r != "already_enrolled") {
            continue;
        }
        let Some(space) = c.space else {
            continue;
        };
        if space.dimension > 4096 {
            continue;
        }
        let key = space_key(&space)?;
        let norm = crate::identity::vector_norm(&c.vector, space.dimension)?;
        spaces.insert(key.clone(), space);
        grouped.entry(key).or_default().push(QueryTurn {
            id: c.turn.id,
            start: c.turn.start_ms,
            end: c.turn.end_ms,
            vector: c.vector,
            norm,
        });
    }
    let input_bytes = account(&groups, &BTreeMap::new())?;
    ensure!(input_bytes <= 128 * 1024 * 1024, CurationError::Capacity);
    let history = history(store, &meeting, &hashes, &spaces, input_bytes)?;
    let mut ops = 0usize;
    for grouped in groups.values() {
        for (key, turns) in grouped {
            let h = history.get(key).map_or(0, |h| h.samples.len());
            let n = turns
                .len()
                .checked_mul(h)
                .and_then(|n| n.checked_mul(spaces[key].dimension))
                .ok_or(CurationError::Capacity)?;
            ops = ops.checked_add(n).ok_or(CurationError::Capacity)?;
        }
    }
    ensure!(ops <= 1_100_000_000, CurationError::Capacity);
    let workspace_bytes = account(&groups, &history)?;
    ensure!(
        workspace_bytes <= 128 * 1024 * 1024,
        CurationError::Capacity
    );
    Ok(PreparedComparison {
        job: job.into(),
        generation: generation(store)?,
        groups,
        history,
        workspace_bytes,
    })
}
fn history(
    store: &Store,
    meeting: &str,
    hashes: &BTreeSet<String>,
    spaces: &BTreeMap<String, EmbeddingSpace>,
    mut decoded_bytes: usize,
) -> Result<BTreeMap<String, HistorySpace>> {
    super::super::preparation_budget::admit_active(store)?;
    let mut q=store.profiles.prepare("SELECT s.rowid,e.model,e.revision,e.model_hash,e.preprocessing,e.dimension,length(CAST(s.provenance_json AS BLOB)),CASE WHEN length(CAST(s.provenance_json AS BLOB))<=1048576 THEN s.provenance_json END FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id JOIN embedding_space e ON e.id=s.space_id WHERE s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id ORDER BY s.id")?;
    let mut rows = q.query([])?;
    let mut history: BTreeMap<String, HistorySpace> = BTreeMap::new();
    let mut admitted = 0usize;
    while let Some(row) = rows.next()? {
        let space = space_json(row, 1)?;
        let key = space_key(&space)?;
        if !spaces.contains_key(&key) {
            continue;
        }
        let h = history.entry(key).or_default();
        h.compatible += 1;
        let provenance = if row.get::<_, i64>(6)? <= 1024 * 1024 {
            row.get::<_, Option<String>>(7)?
                .and_then(|p| serde_json::from_str::<SampleProvenance>(&p).ok())
        } else {
            None
        };
        let Some(p) = provenance.filter(|p| p.validate().is_ok()) else {
            h.invalid += 1;
            admitted += 1;
            ensure!(admitted <= 1024, CurationError::Capacity);
            continue;
        };
        let excluded = p.meeting == meeting || hashes.contains(&p.audio_sha256);
        let vector_bytes: i64 = store.profiles.query_row(
            "SELECT length(CAST(vector_json AS BLOB)) FROM voice_sample WHERE rowid=?1",
            [row.get::<_, i64>(0)?],
            |r| r.get(0),
        )?;
        let vector_bytes = usize::try_from(vector_bytes).map_err(|_| CurationError::Capacity)?;
        let scratch = vector_bytes
            .checked_mul(2)
            .and_then(|n| {
                space
                    .dimension
                    .checked_mul(4)
                    .and_then(|v| n.checked_add(v))
            })
            .and_then(|n| n.checked_add(2 * 1024 * 1024))
            .ok_or(CurationError::Capacity)?;
        ensure!(
            decoded_bytes
                .checked_add(scratch)
                .is_some_and(|n| n <= 128 * 1024 * 1024),
            CurationError::Capacity
        );
        let raw: String = store.profiles.query_row(
            "SELECT vector_json FROM voice_sample WHERE rowid=?1",
            [row.get::<_, i64>(0)?],
            |r| r.get(0),
        )?;
        let vector = bounded_vector(&raw, space.dimension).filter(|v| valid_vector(&space, v));
        drop(raw);
        let Some(vector) = vector else {
            h.invalid += 1;
            if !excluded {
                admitted = admitted.checked_add(1).ok_or(CurationError::Capacity)?;
                ensure!(admitted <= 1024, CurationError::Capacity);
            }
            continue;
        };
        if excluded {
            h.excluded += 1;
            continue;
        }
        admitted = admitted.checked_add(1).ok_or(CurationError::Capacity)?;
        ensure!(admitted <= 1024, CurationError::Capacity);
        let(id_bytes,name_bytes):(i64,i64)=store.profiles.query_row("SELECT length(CAST(s.person_id AS BLOB)),length(CAST(p.name AS BLOB)) FROM voice_sample s JOIN person p ON p.id=s.person_id WHERE s.rowid=?1",[row.get::<_,i64>(0)?],|r|Ok((r.get(0)?,r.get(1)?)))?;
        let additional = usize::try_from(id_bytes)
            .map_err(|_| CurationError::Capacity)?
            .checked_add(usize::try_from(name_bytes).map_err(|_| CurationError::Capacity)?)
            .and_then(|n| n.checked_mul(2))
            .and_then(|n| {
                vector
                    .capacity()
                    .checked_mul(4)
                    .and_then(|v| n.checked_add(v))
            })
            .and_then(|n| n.checked_add(1024))
            .ok_or(CurationError::Capacity)?;
        add(&mut decoded_bytes, additional)?;
        ensure!(decoded_bytes <= 128 * 1024 * 1024, CurationError::Capacity);
        let(person,name):(String,String)=store.profiles.query_row("SELECT s.person_id,p.name FROM voice_sample s JOIN person p ON p.id=s.person_id WHERE s.rowid=?1",[row.get::<_,i64>(0)?],|r|Ok((r.get(0)?,r.get(1)?)))?;
        let norm = crate::identity::vector_norm(&vector, space.dimension)?;
        h.samples.push(HistorySample {
            person,
            name,
            vector,
            norm,
        });
    }
    Ok(history)
}
fn add(total: &mut usize, n: usize) -> Result<()> {
    *total = total.checked_add(n).ok_or(CurationError::Capacity)?;
    Ok(())
}
fn account(groups: &Groups, history: &BTreeMap<String, HistorySpace>) -> Result<usize> {
    // Includes conservative tree/JSON allocation envelopes, not whole-process RSS.
    let mut owned = 1024usize;
    let mut max_workspace = 0usize;
    let mut output = 0usize;
    for (key, h) in history {
        add(&mut owned, key.capacity() + 256)?;
        for s in &h.samples {
            add(
                &mut owned,
                s.vector
                    .capacity()
                    .checked_mul(4)
                    .ok_or(CurationError::Capacity)?
                    + s.person.capacity()
                    + s.name.capacity()
                    + 512,
            )?;
        }
    }
    for ((track, label), spaces) in groups {
        add(&mut owned, track.capacity() + label.capacity() + 512)?;
        for (key, turns) in spaces {
            add(&mut owned, key.capacity() + 512)?;
            let mut max_id = 0;
            for t in turns {
                max_id = max_id.max(t.id.capacity());
                add(
                    &mut owned,
                    t.id.capacity()
                        + t.vector
                            .capacity()
                            .checked_mul(4)
                            .ok_or(CurationError::Capacity)?
                        + 256,
                )?;
            }
            let mut persons = BTreeMap::new();
            if let Some(h) = history.get(key) {
                for s in &h.samples {
                    let identity = persons.entry(&s.person).or_insert((0usize, 0usize));
                    identity.0 = identity.0.max(s.person.capacity());
                    identity.1 = identity.1.max(s.name.capacity());
                }
            }
            let detail = 2048usize
                .checked_add(max_id.checked_mul(2).ok_or(CurationError::Capacity)?)
                .ok_or(CurationError::Capacity)?;
            let per_person = detail
                .checked_mul(turns.len().min(32))
                .and_then(|n| n.checked_add(1024))
                .ok_or(CurationError::Capacity)?;
            let mut identities = 0usize;
            let mut largest_identity = 0usize;
            for &(person, name) in persons.values() {
                let identity = person.checked_add(name).ok_or(CurationError::Capacity)?;
                add(&mut identities, identity)?;
                largest_identity = largest_identity.max(identity);
            }
            // All accumulator identities and the pre-top3 JSON ranking can coexist.
            // Arbitrary name/ID capacities are separate from fixed tree/detail envelopes.
            let workspace = persons
                .len()
                .checked_mul(per_person)
                .and_then(|n| identities.checked_mul(2).and_then(|ids| n.checked_add(ids)))
                .ok_or(CurationError::Capacity)?;
            max_workspace = max_workspace.max(workspace);
            add(
                &mut output,
                persons
                    .len()
                    .min(3)
                    .checked_mul(
                        per_person
                            .checked_add(largest_identity)
                            .ok_or(CurationError::Capacity)?,
                    )
                    .ok_or(CurationError::Capacity)?
                    + key.capacity()
                    + track.capacity()
                    + label.capacity()
                    + 512,
            )?;
        }
    }
    add(&mut owned, max_workspace)?;
    add(
        &mut owned,
        output.checked_mul(2).ok_or(CurationError::Capacity)?,
    )?;
    Ok(owned)
}

fn bounded_vector(raw: &str, dimension: usize) -> Option<Vec<f32>> {
    use serde::de::{DeserializeSeed, Error, SeqAccess, Visitor};
    struct Vector(usize);
    impl<'de> Visitor<'de> for Vector {
        type Value = Vec<f32>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("a dimension-bounded numeric vector")
        }
        fn visit_seq<A: SeqAccess<'de>>(
            self,
            mut seq: A,
        ) -> std::result::Result<Self::Value, A::Error> {
            let mut vector = Vec::with_capacity(self.0);
            while let Some(value) = seq.next_element::<f32>()? {
                if vector.len() == self.0 {
                    return Err(A::Error::custom("vector dimension mismatch"));
                }
                vector.push(value);
            }
            if vector.len() != self.0 {
                return Err(A::Error::custom("vector dimension mismatch"));
            }
            Ok(vector)
        }
    }
    impl<'de> DeserializeSeed<'de> for Vector {
        type Value = Vec<f32>;
        fn deserialize<D: serde::Deserializer<'de>>(
            self,
            deserializer: D,
        ) -> std::result::Result<Self::Value, D::Error> {
            deserializer.deserialize_seq(self)
        }
    }
    let mut decoder = serde_json::Deserializer::from_str(raw);
    let vector = Vector(dimension).deserialize(&mut decoder).ok()?;
    decoder.end().ok()?;
    Some(vector)
}
