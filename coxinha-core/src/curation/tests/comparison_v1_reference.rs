use super::legacy_sample_budget as sample_budget;
use super::*;
struct HistorySample {
    person: String,
    name: String,
    vector: Vec<f32>,
    norm: f64,
}
#[derive(Default)]
struct HistorySpace {
    compatible: usize,
    excluded: usize,
    invalid: usize,
    samples: Vec<HistorySample>,
}
fn history(
    store: &Store,
    meeting: &str,
    hashes: &BTreeSet<String>,
) -> Result<BTreeMap<String, HistorySpace>> {
    let mut q=store.profiles.prepare("SELECT s.person_id,p.name,s.vector_json,s.provenance_json,e.model,e.revision,e.model_hash,e.preprocessing,e.dimension FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id JOIN person p ON p.id=s.person_id JOIN embedding_space e ON e.id=s.space_id WHERE s.revoked=0 AND a.state='confirmed' AND a.revision=s.assignment_revision AND a.person_id=s.person_id ORDER BY s.id LIMIT 1025")?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                space_json(r, 4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ensure!(
        rows.len() <= 1024,
        "comparison history sample limit exceeded"
    );
    let mut spaces: BTreeMap<String, HistorySpace> = BTreeMap::new();
    for (person, name, vector, provenance, space) in rows {
        let entry = spaces.entry(space_key(&space)?).or_default();
        entry.compatible += 1;
        let parsed = (|| -> Result<(Vec<f32>, SampleProvenance)> {
            Ok((
                serde_json::from_str(&vector)?,
                serde_json::from_str(&provenance)?,
            ))
        })();
        let Ok((vector, p)) = parsed else {
            entry.invalid += 1;
            continue;
        };
        if space.dimension > 4096 || !valid_vector(&space, &vector) || p.validate().is_err() {
            entry.invalid += 1;
            continue;
        }
        if p.meeting == meeting || hashes.contains(&p.audio_sha256) {
            entry.excluded += 1;
            continue;
        }
        let norm = crate::identity::vector_norm(&vector, space.dimension)?;
        entry.samples.push(HistorySample {
            person,
            name,
            vector,
            norm,
        });
    }
    Ok(spaces)
}
impl Store {
    pub fn voice_comparison_v1_reference(&self, job: &str) -> Result<Value> {
        let _snapshot = snapshot(self)?;
        sample_budget(self)?;
        let (meeting, report, manifest) = bounded_report(self, job)?;
        let hashes = manifest
            .tracks
            .iter()
            .filter_map(|t| t.sha256.clone())
            .collect();
        let history = history(self, &meeting, &hashes)?;
        let candidates = candidates::load_candidates(self, job, &meeting, &report, &manifest)?;
        let mut grouped: BTreeMap<(String, String), BTreeMap<String, Vec<&Candidate>>> =
            BTreeMap::new();
        let mut query_count = 0;
        for c in &candidates {
            if c.turn.speaker == "unknown" {
                continue;
            }
            let spaces = grouped
                .entry((c.turn.track.clone(), c.turn.speaker.clone()))
                .or_default();
            if c.reasons.iter().any(|reason| *reason != "already_enrolled") {
                continue;
            }
            let Some(space) = c.space.as_ref() else {
                continue;
            };
            if space.dimension > 4096 {
                continue;
            }
            query_count += 1;
            ensure!(
                query_count <= MAX_SELECTED,
                "comparison query turn limit exceeded"
            );
            spaces.entry(space_key(space)?).or_default().push(c);
        }
        let mut operations = 0usize;
        let mut speakers = Vec::new();
        for ((track, speaker), spaces) in grouped {
            let mut results = Vec::new();
            for (key, turns) in spaces {
                let space = turns[0].space.as_ref().unwrap();
                let h = history.get(&key);
                let mut people: BTreeMap<String, (String, usize, Vec<Value>)> = BTreeMap::new();
                if let Some(h) = h {
                    for turn in &turns {
                        let norm = crate::identity::vector_norm(&turn.vector, space.dimension)?;
                        let mut per_person: BTreeMap<&str, (&str, usize, f64)> = BTreeMap::new();
                        for sample in &h.samples {
                            operations = operations
                                .checked_add(space.dimension)
                                .ok_or_else(|| anyhow::anyhow!("comparison work overflow"))?;
                            ensure!(
                                operations <= 8_000_000,
                                "comparison scalar work limit exceeded"
                            );
                            let score = (sample
                                .vector
                                .iter()
                                .zip(&turn.vector)
                                .map(|(a, b)| *a as f64 * *b as f64)
                                .sum::<f64>()
                                / (sample.norm * norm))
                                .clamp(-1., 1.);
                            let entry =
                                per_person
                                    .entry(&sample.person)
                                    .or_insert((&sample.name, 0, -1.));
                            entry.1 += 1;
                            entry.2 = entry.2.max(score);
                        }
                        for (person, (name, count, score)) in per_person {
                            let entry = people
                                .entry(person.into())
                                .or_insert_with(|| (name.into(), count, vec![]));
                            entry.2.push(json!({"turnId":turn.turn.id,"startMs":turn.turn.start_ms,"endMs":turn.turn.end_ms,"cosine":score}));
                        }
                    }
                }
                let mut ranking = Vec::new();
                for (person, (name, count, details)) in people {
                    let mean = details
                        .iter()
                        .map(|d| d["cosine"].as_f64().unwrap())
                        .sum::<f64>()
                        / details.len() as f64;
                    let max = details
                        .iter()
                        .map(|d| d["cosine"].as_f64().unwrap())
                        .fold(-1., f64::max);
                    let duration: u64 = details
                        .iter()
                        .map(|d| d["endMs"].as_u64().unwrap() - d["startMs"].as_u64().unwrap())
                        .sum();
                    ranking.push(json!({"personId":person,"name":name,"meanCosine":mean,"maxCosine":max,"supportTurns":details.len(),"supportDurationMs":duration,"activeSamples":count,"turnDetailsTruncated":details.len()>32,"turns":details.into_iter().take(32).collect::<Vec<_>>()}));
                }
                ranking.sort_by(|a, b| {
                    b["meanCosine"]
                        .as_f64()
                        .unwrap()
                        .total_cmp(&a["meanCosine"].as_f64().unwrap())
                        .then_with(|| a["personId"].as_str().cmp(&b["personId"].as_str()))
                });
                ranking.truncate(3);
                let status = if !ranking.is_empty() {
                    "candidates"
                } else if h.is_none_or(|h| h.compatible == 0) {
                    "no_compatible_history"
                } else if h
                    .is_some_and(|h| h.excluded > 0 && h.samples.is_empty() && h.invalid == 0)
                {
                    "self_excluded"
                } else {
                    "no_candidates"
                };
                results.push(json!({"space":space,"status":status,"invalidHistorySamples":h.map_or(0,|h|h.invalid),"candidates":ranking}));
            }
            speakers.push(json!({"track":track,"speaker":speaker,"queryStatus":if results.is_empty(){"no_eligible_turns"}else{"eligible"},"spaces":results}));
        }
        Ok(
            json!({"job":job,"experimental":true,"profileGeneration":generation(self)?,"speakers":speakers}),
        )
    }
}
