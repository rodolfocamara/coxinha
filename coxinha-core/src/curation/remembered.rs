//! Voices remembered from the owner's confirmations (spec 0120). The queue is
//! a query: a confirmed revision without an enrollment record is pending.
use super::*;
use crate::identity::VerifiedEnrollmentSource;

pub const PER_CONFIRMATION: usize = 16;
pub const MIN_SAMPLE_MS: u64 = 1000;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remembered {
    pub assignment_id: String,
    pub state: &'static str,
    pub samples: usize,
    pub error: Option<String>,
}
struct Pending {
    id: String,
    scope: String,
    person: String,
    revision: i64,
    origin: String,
}
const PENDING: &str = "SELECT a.id,a.speaker,a.person_id,a.revision,a.human_origin,a.meeting_id FROM assignment a WHERE a.state='confirmed' AND a.person_id IS NOT NULL AND a.human_origin IS NOT NULL AND NOT EXISTS(SELECT 1 FROM voice_enrollment e WHERE e.assignment_id=a.id AND e.assignment_revision=a.revision)";
const MEMORY_ON: &str =
    "NOT EXISTS(SELECT 1 FROM voice_memory_off o WHERE o.person_id=a.person_id)";

fn duration(c: &Candidate) -> u64 {
    c.turn.end_ms - c.turn.start_ms
}
/// Longest eligible turns of one track + label, ties by time.
fn choose<'a>(candidates: &'a [Candidate], track: &str, speaker: &str) -> Vec<&'a Candidate> {
    let mut eligible: Vec<_> = candidates
        .iter()
        .filter(|c| {
            c.turn.track == track
                && c.turn.speaker == speaker
                && c.eligible()
                && duration(c) >= MIN_SAMPLE_MS
        })
        .collect();
    eligible.sort_by(|a, b| {
        duration(b)
            .cmp(&duration(a))
            .then(a.turn.start_ms.cmp(&b.turn.start_ms))
    });
    eligible.truncate(PER_CONFIRMATION);
    eligible
}
fn reason(error: &anyhow::Error) -> String {
    let text = format!("{error:#}");
    text.chars().take(300).collect()
}

impl Store {
    /// Meeting of the oldest pending confirmation not in `skip`.
    pub fn next_voice_meeting(&self, skip: &BTreeSet<String>) -> Result<Option<String>> {
        let mut q = self
            .profiles
            .prepare(&format!("{PENDING} AND {MEMORY_ON} ORDER BY a.rowid"))?;
        let rows = q.query_map([], |r| r.get::<_, String>(5))?;
        for meeting in rows {
            let meeting = meeting?;
            if !skip.contains(&meeting) {
                return Ok(Some(meeting));
            }
        }
        Ok(None)
    }
    fn pending_voices(&self, meeting: &str) -> Result<Vec<Pending>> {
        let mut q = self.profiles.prepare(&format!(
            "{PENDING} AND {MEMORY_ON} AND a.meeting_id=?1 ORDER BY a.rowid"
        ))?;
        let rows = q.query_map([meeting], |r| {
            Ok(Pending {
                id: r.get(0)?,
                scope: r.get(1)?,
                person: r.get(2)?,
                revision: r.get(3)?,
                origin: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
    fn record_voice(&self, p: &Pending, outcome: &Remembered) -> Result<()> {
        self.profiles.execute("INSERT OR REPLACE INTO voice_enrollment(assignment_id,assignment_revision,state,samples,error) VALUES(?1,?2,?3,?4,?5)", params![p.id, p.revision, outcome.state, outcome.samples as i64, outcome.error])?;
        Ok(())
    }
    fn fail_all(&self, pending: &[Pending], error: &anyhow::Error) -> Result<Vec<Remembered>> {
        let mut outcomes = Vec::new();
        for p in pending {
            let outcome = Remembered {
                assignment_id: p.id.clone(),
                state: "failed",
                samples: 0,
                error: Some(reason(error)),
            };
            self.record_voice(p, &outcome)?;
            outcomes.push(outcome);
        }
        Ok(outcomes)
    }
    /// Remembers every pending confirmation of one meeting against a source
    /// hashed beforehand. Each outcome is recorded, so a second pass is a no-op.
    pub fn remember_voices(
        &self,
        meeting: &str,
        source: Result<VerifiedEnrollmentSource>,
    ) -> Result<Vec<Remembered>> {
        let pending = self.pending_voices(meeting)?;
        if pending.is_empty() {
            return Ok(vec![]);
        }
        let source = match source.and_then(|s| {
            ensure!(
                s.manifest.meeting == meeting && s.root == self.root,
                "voice source belongs to another meeting"
            );
            Ok(s)
        }) {
            Ok(source) => source,
            Err(error) => return self.fail_all(&pending, &error),
        };
        let tx = Transaction::new_unchecked(&self.profiles, TransactionBehavior::Immediate)?;
        let mut jobs = BTreeMap::new();
        let mut outcomes = Vec::new();
        let mut inserted = 0;
        for p in &pending {
            self.profiles.execute_batch("SAVEPOINT voice")?;
            let outcome = match self.remember_one(p, meeting, &source, &mut jobs) {
                Ok((samples, new)) => {
                    self.profiles.execute_batch("RELEASE voice")?;
                    inserted += new;
                    Remembered {
                        assignment_id: p.id.clone(),
                        state: "enrolled",
                        samples,
                        error: None,
                    }
                }
                Err(error) => {
                    self.profiles
                        .execute_batch("ROLLBACK TO voice; RELEASE voice")?;
                    Remembered {
                        assignment_id: p.id.clone(),
                        state: "failed",
                        samples: 0,
                        error: Some(reason(&error)),
                    }
                }
            };
            self.record_voice(p, &outcome)?;
            outcomes.push(outcome);
        }
        // Every in-app change to raw tracks rewrites the manifest checksum.
        let current: Result<crate::capture::CaptureManifest> = (|| {
            Ok(serde_json::from_reader(std::fs::File::open(
                self.root.join("raw").join(meeting).join("manifest.json"),
            )?)?)
        })();
        let unchanged = current
            .and_then(|m| Ok(crate::processing::hash_json(&m)?))
            .is_ok_and(|h| crate::processing::hash_json(&source.manifest).is_ok_and(|s| s == h));
        if !unchanged {
            drop(tx);
            return self.fail_all(
                &pending,
                &anyhow::anyhow!("sample source manifest changed during enrollment"),
            );
        }
        if inserted > 0 {
            tx.execute(
                "UPDATE profile_revision SET revision=revision+1 WHERE id=1",
                [],
            )?;
        }
        tx.commit()?;
        Ok(outcomes)
    }
    /// Returns (active samples, newly inserted).
    fn remember_one(
        &self,
        p: &Pending,
        meeting: &str,
        source: &VerifiedEnrollmentSource,
        jobs: &mut BTreeMap<String, std::result::Result<Vec<Candidate>, String>>,
    ) -> Result<(usize, usize)> {
        let existing: i64 = self.profiles.query_row("SELECT count(*) FROM voice_sample WHERE assignment_id=?1 AND assignment_revision=?2 AND person_id=?3 AND revoked=0", params![p.id, p.revision, p.person], |r| r.get(0))?;
        if existing > 0 {
            return Ok((existing as usize, 0));
        }
        let mut parts = p.scope.splitn(3, ':');
        let (Some(job), Some(track), Some(speaker)) = (parts.next(), parts.next(), parts.next())
        else {
            anyhow::bail!("assignment has no source track");
        };
        if !jobs.contains_key(job) {
            let loaded = (|| {
                let (owner, report, manifest) = bounded_report(self, job)?;
                ensure!(owner == meeting, "assignment source meeting mismatch");
                ensure!(
                    crate::processing::hash_json(&manifest)?
                        == crate::processing::hash_json(&source.manifest)?,
                    "source changed after verification"
                );
                candidates::load_candidates(self, job, &owner, &report, &manifest)
            })()
            .map_err(|e| format!("{e:#}"));
            jobs.insert(job.to_owned(), loaded);
        }
        let candidates = jobs[job].as_ref().map_err(|e| anyhow::anyhow!("{e}"))?;
        let chosen = choose(candidates, track, speaker);
        ensure!(!chosen.is_empty(), "no eligible voice samples");
        let (active, mut bytes) = active_budget(self)?;
        ensure!(
            active + chosen.len() <= MAX_INVENTORY,
            CurationError::Capacity
        );
        let now: String = self
            .profiles
            .query_row("SELECT CURRENT_TIMESTAMP", [], |r| r.get(0))?;
        let mut inserted = 0;
        for c in chosen {
            let space = self.register_space(c.space.as_ref().unwrap())?;
            let source_turn = c.provenance.as_ref().unwrap();
            // A reprocessed job of the same recording repeats intervals.
            let duplicate: i64 = self.profiles.query_row("SELECT count(*) FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id WHERE s.space_id=?1 AND s.revoked=0 AND a.state='confirmed' AND a.person_id=s.person_id AND a.revision=s.assignment_revision AND json_extract(s.provenance_json,'$.audio_sha256')=?2 AND json_extract(s.provenance_json,'$.track')=?3 AND json_extract(s.provenance_json,'$.start_ms')=?4 AND json_extract(s.provenance_json,'$.end_ms')=?5",params![space,source_turn.audio_sha256,source_turn.track,i64::try_from(source_turn.start_ms)?,i64::try_from(source_turn.end_ms)?],|r|r.get(0))?;
            if duplicate > 0 {
                continue;
            }
            let id = uuid::Uuid::new_v4().to_string();
            let mut provenance = serde_json::to_value(source_turn)?;
            provenance["confirmation"] = json!({"sampleId":id,"job":job,"turnId":c.turn.id,"assignmentId":p.id,"assignmentRevision":p.revision,"humanOrigin":p.origin,"createdAt":now});
            let vector_json = serde_json::to_string(&c.vector)?;
            let provenance_json = serde_json::to_string(&provenance)?;
            bytes = bytes
                .checked_add(vector_json.len() + provenance_json.len())
                .ok_or(CurationError::Capacity)?;
            ensure!(bytes <= 32 * 1024 * 1024, CurationError::Capacity);
            self.profiles.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,p.id,p.revision,p.person,space,vector_json,provenance_json])?;
            inserted += 1;
        }
        ensure!(inserted > 0, "no eligible voice samples");
        Ok((inserted, inserted))
    }
    /// A failed confirmation goes back to the queue.
    pub fn retry_voice(&self, assignment: &str) -> Result<()> {
        let n = self.profiles.execute("DELETE FROM voice_enrollment WHERE assignment_id=?1 AND state='failed' AND assignment_revision=(SELECT revision FROM assignment WHERE id=?1)", [assignment])?;
        ensure!(n == 1, "no failed voice enrollment to retry");
        Ok(())
    }
    /// Revokes every sample of the person and stops remembering their voice.
    pub fn forget_voice(&self, person: &str, origin: &str) -> Result<usize> {
        selected::validate_origin(origin)?;
        let _: String =
            self.profiles
                .query_row("SELECT id FROM person WHERE id=?1", [person], |r| r.get(0))?;
        self.profiles.execute("INSERT INTO voice_memory_off(person_id,human_origin) VALUES(?1,?2) ON CONFLICT(person_id) DO UPDATE SET human_origin=excluded.human_origin", params![person, origin.trim()])?;
        let ids = {
            let mut q = self
                .profiles
                .prepare("SELECT id FROM voice_sample WHERE person_id=?1 AND revoked=0")?;
            let rows = q.query_map([person], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for id in &ids {
            self.revoke_voice_sample(person, id, origin)?;
        }
        Ok(ids.len())
    }
    /// Turns voice memory back on; past confirmations are remembered again.
    pub fn remember_voice_again(&self, person: &str) -> Result<()> {
        let tx = Transaction::new_unchecked(&self.profiles, TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM voice_memory_off WHERE person_id=?1", [person])?;
        tx.execute("DELETE FROM voice_enrollment WHERE assignment_id IN (SELECT id FROM assignment WHERE person_id=?1)", [person])?;
        tx.commit()?;
        Ok(())
    }
    pub fn voice_memory(&self, person: &str) -> Result<Value> {
        let off: bool = self.profiles.query_row(
            "SELECT count(*)>0 FROM voice_memory_off WHERE person_id=?1",
            [person],
            |r| r.get(0),
        )?;
        let pending: i64 = self.profiles.query_row(
            &format!("SELECT count(*) FROM ({PENDING} AND {MEMORY_ON} AND a.person_id=?1)"),
            [person],
            |r| r.get(0),
        )?;
        let mut q = self.profiles.prepare("SELECT a.id,a.meeting_id,e.error FROM voice_enrollment e JOIN assignment a ON a.id=e.assignment_id AND a.revision=e.assignment_revision WHERE a.person_id=?1 AND a.state='confirmed' AND e.state='failed' ORDER BY e.rowid")?;
        let failed = q
            .query_map([person], |r| {
                Ok(json!({"assignmentId":r.get::<_,String>(0)?,"meetingId":r.get::<_,String>(1)?,"error":r.get::<_,Option<String>>(2)?}))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(json!({"personId":person,"off":off,"pending":pending,"failed":failed}))
    }
}
