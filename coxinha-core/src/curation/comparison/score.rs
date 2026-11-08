use super::*;
struct Accumulator {
    name: String,
    active: usize,
    count: usize,
    duration: u64,
    sum: f64,
    max: f64,
    details: Vec<Value>,
}
pub(super) fn score(input: PreparedComparison, cancel: &AtomicBool) -> Result<Value> {
    let mut speakers = Vec::new();
    for ((track, speaker), spaces) in input.groups {
        let mut results = Vec::new();
        for (key, turns) in spaces {
            let space: EmbeddingSpace = serde_json::from_str(&key)?;
            let h = input.history.get(&key);
            let mut people: BTreeMap<String, Accumulator> = BTreeMap::new();
            for (i, turn) in turns.iter().enumerate() {
                if i.is_multiple_of(8) {
                    ensure!(!cancel.load(Ordering::Acquire), CurationError::Refresh);
                }
                let mut per_person: BTreeMap<&str, (&str, usize, f64)> = BTreeMap::new();
                if let Some(h) = h {
                    for sample in &h.samples {
                        let score = (sample
                            .vector
                            .iter()
                            .zip(&turn.vector)
                            .map(|(a, b)| *a as f64 * *b as f64)
                            .sum::<f64>()
                            / (sample.norm * turn.norm))
                            .clamp(-1., 1.);
                        let entry =
                            per_person
                                .entry(&sample.person)
                                .or_insert((&sample.name, 0, -1.));
                        entry.1 += 1;
                        entry.2 = entry.2.max(score);
                    }
                }
                for (person, (name, count, score)) in per_person {
                    let a = people.entry(person.into()).or_insert_with(|| Accumulator {
                        name: name.into(),
                        active: count,
                        count: 0,
                        duration: 0,
                        sum: 0.,
                        max: -1.,
                        details: vec![],
                    });
                    a.count += 1;
                    a.duration = a
                        .duration
                        .checked_add(turn.end - turn.start)
                        .ok_or(CurationError::Capacity)?;
                    a.sum += score;
                    a.max = a.max.max(score);
                    if a.details.len() < 32 {
                        a.details.push(json!({"turnId":turn.id,"startMs":turn.start,"endMs":turn.end,"cosine":score}));
                    }
                }
            }
            let mut ranking = Vec::new();
            for (person, a) in people {
                ranking.push(json!({"personId":person,"name":a.name,"meanCosine":a.sum/a.count as f64,"maxCosine":a.max,"supportTurns":a.count,"supportDurationMs":a.duration,"activeSamples":a.active,"turnDetailsTruncated":a.count>32,"turns":a.details}));
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
            } else if h.is_some_and(|h| h.excluded > 0 && h.samples.is_empty() && h.invalid == 0) {
                "self_excluded"
            } else {
                "no_candidates"
            };
            results.push(json!({"space":space,"status":status,"invalidHistorySamples":h.map_or(0,|h|h.invalid),"candidates":ranking}));
        }
        speakers.push(json!({"track":track,"speaker":speaker,"queryStatus":if results.is_empty(){"no_eligible_turns"}else{"eligible"},"spaces":results}));
    }
    ensure!(!cancel.load(Ordering::Acquire), CurationError::Refresh);
    Ok(
        json!({"job":input.job,"experimental":true,"profileGeneration":input.generation,"speakers":speakers}),
    )
}
