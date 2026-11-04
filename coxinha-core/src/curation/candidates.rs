use super::*;

pub(super) fn load_candidates(
    store: &Store,
    job: &str,
    meeting: &str,
    report: &ProcessingReport,
    manifest: &crate::capture::CaptureManifest,
) -> Result<Vec<Candidate>> {
    active_budget(store)?;
    preparation_budget::admit_candidates(store, job)?;
    let bytes: i64 = store.profiles.query_row("SELECT coalesce(sum(length(space_json)+length(vector_json)+length(provenance_json)),0) FROM processed_candidate WHERE job_id=?1",[job],|r|r.get(0))?;
    ensure!(
        bytes <= 16 * 1024 * 1024,
        "private candidate byte limit exceeded"
    );
    let mut q = store.profiles.prepare("SELECT turn_id,speaker,space_json,vector_json,provenance_json FROM processed_candidate WHERE job_id=?1 LIMIT 4097")?;
    let raw = q
        .query_map([job], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ),
            ))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    ensure!(
        raw.len() <= MAX_REPORT_TURNS,
        "private candidate limit exceeded"
    );
    let mut active = store.profiles.prepare("SELECT s.provenance_json,e.model,e.revision,e.model_hash,e.preprocessing,e.dimension FROM voice_sample s JOIN embedding_space e ON e.id=s.space_id JOIN assignment a ON a.id=s.assignment_id WHERE s.revoked=0 AND a.state='confirmed' AND a.person_id=s.person_id AND a.revision=s.assignment_revision LIMIT 4097")?;
    let rows = active
        .query_map([], |r| Ok((r.get::<_, String>(0)?, space_json(r, 1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ensure!(rows.len() <= MAX_INVENTORY, CurationError::Capacity);
    let mut counts: BTreeMap<(String, String, String, u64, u64), usize> = BTreeMap::new();
    for (row, space) in rows {
        if let Ok(p) = serde_json::from_str::<SampleProvenance>(&row) {
            *counts
                .entry((
                    space_key(&space)?,
                    p.audio_sha256,
                    p.track,
                    p.start_ms,
                    p.end_ms,
                ))
                .or_default() += 1;
        }
    }
    let mut candidates = Vec::new();
    for turn in &report.turns {
        let mut c = Candidate {
            turn: turn.clone(),
            space: None,
            vector: vec![],
            provenance: None,
            reasons: vec![],
            active_count: 0,
        };
        if turn.speaker == "unknown" || turn.speaker.trim().is_empty() {
            c.reasons.push("unknown_speaker");
        }
        if report.turns.iter().any(|other| {
            other.id != turn.id
                && other.track == turn.track
                && other.start_ms < turn.end_ms
                && other.end_ms > turn.start_ms
        }) {
            c.reasons.push("same_track_overlap");
        }
        match raw.get(&turn.id) {
            None => c.reasons.push("missing_embedding"),
            Some((speaker, s, v, p)) => {
                let parsed = (|| -> Result<(EmbeddingSpace, Vec<f32>, SampleProvenance)> {
                    Ok((
                        serde_json::from_str(s)?,
                        serde_json::from_str(v)?,
                        serde_json::from_str(p)?,
                    ))
                })();
                match parsed {
                    Err(_) => c.reasons.push("invalid_candidate"),
                    Ok((space, vector, p)) => {
                        if !valid_vector(&space, &vector) || p.validate().is_err() {
                            c.reasons.push("invalid_candidate");
                        }
                        let source = manifest
                            .tracks
                            .iter()
                            .enumerate()
                            .find(|(i, _)| manifest.track_id(*i).ok() == Some(turn.track.as_str()))
                            .map(|(_, t)| t);
                        if speaker != &turn.speaker
                            || p.meeting != meeting
                            || p.track != turn.track
                            || p.start_ms != turn.start_ms
                            || p.end_ms != turn.end_ms
                            || source.is_none_or(|t| {
                                t.sha256.as_deref() != Some(p.audio_sha256.as_str())
                                    || p.end_ms as u128 * manifest.sample_rate as u128
                                        > t.frames as u128 * 1000
                            })
                        {
                            c.reasons.push("provenance_mismatch");
                        }
                        c.active_count = counts
                            .get(&(
                                space_key(&space)?,
                                p.audio_sha256.clone(),
                                p.track.clone(),
                                p.start_ms,
                                p.end_ms,
                            ))
                            .copied()
                            .unwrap_or(0);
                        if c.active_count > 0 {
                            c.reasons.push("already_enrolled");
                        }
                        c.space = Some(space);
                        c.vector = vector;
                        c.provenance = Some(p);
                    }
                }
            }
        }
        candidates.push(c);
    }
    Ok(candidates)
}

impl Store {
    pub fn enrollment_candidates(&self, job: &str, track: &str, speaker: &str) -> Result<Value> {
        let _snapshot = snapshot(self)?;
        let (meeting, report, manifest) = bounded_report(self, job)?;
        let turns: Vec<_> = load_candidates(self, job, &meeting, &report, &manifest)?
            .into_iter()
            .filter(|c| c.turn.track == track && c.turn.speaker == speaker)
            .collect();
        ensure!(!turns.is_empty(), "speaker absent from exact job and track");
        let scope = format!("{job}:{track}:{speaker}");
        let assignment: Option<(String,Option<String>,i64)> = self.profiles.query_row("SELECT id,person_id,revision FROM assignment WHERE meeting_id=?1 AND speaker=?2 AND state='confirmed' ORDER BY rowid DESC LIMIT 1",params![meeting,scope],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        Ok(
            json!({"job":job,"meetingId":meeting,"track":track,"speaker":speaker,"profileGeneration":generation(self)?,"assignmentId":assignment.as_ref().map(|a|&a.0),"personId":assignment.as_ref().and_then(|a|a.1.as_ref()),"assignmentRevision":assignment.as_ref().map(|a|a.2),"turns":turns.iter().map(|c|json!({"turnId":c.turn.id,"startMs":c.turn.start_ms,"endMs":c.turn.end_ms,"eligible":c.eligible(),"reasons":c.reasons,"activeSampleCount":c.active_count})).collect::<Vec<_>>(),"quality":{"noise":"unmeasured","echo":"unmeasured","otherTrack":"unmeasured"}}),
        )
    }
}
