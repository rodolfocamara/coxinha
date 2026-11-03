use super::*;
use crate::identity::verify_enrollment_source_at;

struct Library {
    _d: tempfile::TempDir,
    store: Store,
    meeting: String,
    job: String,
    person: String,
}
fn turn(id: &str, speaker: &str, start: u64, end: u64) -> SpeakerTurn {
    let mut t = result().turns[0].clone();
    t.id = id.into();
    t.speaker = speaker.into();
    t.start_ms = start;
    t.end_ms = end;
    t
}
/// 30 s of audio; 20 turns of speaker-0 from 1.0 s to 2.9 s long, one short
/// turn and one overlapped by another cluster.
fn library() -> Result<Library> {
    let (d, mut store, config, _, unrelated) = fixture()?;
    store.decide_assignment(&unrelated.assignment_id, None, "revoked", "not under test")?;
    let meeting = store.create_meeting("remembered voices")?;
    let mut r = Recording::start(&store, &meeting, "fixture-mic", "fixture-output")?;
    for track in [Track::Mic, Track::Output] {
        for i in 0..360 {
            r.write_block(track, &[21; 4000], (i + 1) * 83_333_334)?;
        }
    }
    r.finish(&store, false)?;
    let mut turns: Vec<_> = (0..20u64)
        .map(|i| turn(&format!("t{i:02}"), "speaker-0", i * 1400, i * 1400 + 1000 + (i % 4) * 100))
        .collect();
    turns.push(turn("short", "speaker-0", 28_100, 28_600));
    turns.push(turn("overlapped", "speaker-0", 28_700, 29_900));
    turns.push(turn("other", "speaker-1", 29_000, 29_500));
    let mut output = result();
    output.turns = turns;
    let mut config = config;
    config.engine_version = "remembered".into();
    let job = process(&mut store, &meeting, &config, output)?;
    let person = store.create_person("Participant", &[], "test consent")?;
    Ok(Library {
        _d: d,
        store,
        meeting,
        job,
        person,
    })
}
impl Library {
    fn confirm(&mut self, person: &str) -> Result<String> {
        let person = person.to_owned();
        self.store.confirm_processed_track_speaker(
            &self.job,
            "speaker-0",
            Some("mic"),
            &person,
            "I listened to the excerpt",
        )
    }
    fn remember(&self) -> Result<Vec<Remembered>> {
        let source = verify_enrollment_source_at(&self.store.root, &self.meeting);
        self.store.remember_voices(&self.meeting, source)
    }
    fn voice(&self) -> Result<Option<crate::processing::VoiceState>> {
        Ok(self
            .store
            .processing_report_by_job(&self.job)?
            .assignments
            .into_iter()
            .find(|a| a.speaker == "speaker-0")
            .and_then(|a| a.voice))
    }
    fn active(&self) -> Result<i64> {
        Ok(self.store.profiles.query_row(
            "SELECT count(*) FROM voice_sample WHERE revoked=0",
            [],
            |r| r.get(0),
        )?)
    }
}

#[test]
fn remembers_the_longest_eligible_turns_once() -> Result<()> {
    let mut l = library()?;
    let assignment = l.confirm(&l.person.clone())?;
    assert_eq!(l.voice()?.unwrap().state, "pending");
    assert_eq!(
        l.store.next_voice_meeting(&BTreeSet::new())?,
        Some(l.meeting.clone())
    );
    let outcome = l.remember()?;
    assert_eq!(
        outcome,
        vec![Remembered {
            assignment_id: assignment.clone(),
            state: "enrolled",
            samples: PER_CONFIRMATION,
            error: None,
        }]
    );
    let mut q = l
        .store
        .profiles
        .prepare("SELECT provenance_json FROM voice_sample")?;
    let rows: Vec<Value> = q
        .query_map([], |r| r.get::<_, String>(0))?
        .map(|p| serde_json::from_str(&p.unwrap()).unwrap())
        .collect();
    let ids: BTreeSet<_> = rows
        .iter()
        .map(|p| p["confirmation"]["turnId"].as_str().unwrap().to_owned())
        .collect();
    assert!(!ids.contains("short") && !ids.contains("overlapped"));
    // Fifteen 1.1–1.3 s turns, then the earliest of the five 1.0 s turns.
    assert!(ids.contains("t00"));
    assert!(["t04", "t08", "t12", "t16"].iter().all(|id| !ids.contains(*id)));
    assert_eq!(rows[0]["confirmation"]["assignmentId"], json!(assignment));
    assert_eq!(
        rows[0]["confirmation"]["humanOrigin"],
        json!("I listened to the excerpt")
    );
    assert_eq!(rows[0]["meeting"], json!(l.meeting));
    let voice = l.voice()?.unwrap();
    assert_eq!((voice.state.as_str(), voice.samples), ("enrolled", 16));
    assert!(l.remember()?.is_empty());
    assert_eq!(l.store.next_voice_meeting(&BTreeSet::new())?, None);
    assert_eq!(l.active()?, 16);
    Ok(())
}

#[test]
fn existing_samples_are_kept_and_failures_are_recorded_and_retryable() -> Result<()> {
    let mut l = library()?;
    let assignment = l.confirm(&l.person.clone())?;
    let selection = SelectedEnrollment {
        job: l.job.clone(),
        track: "mic".into(),
        speaker: "speaker-0".into(),
        assignment_id: assignment.clone(),
        person_id: l.person.clone(),
        expected_assignment_revision: 2,
        turn_ids: vec!["t01".into()],
        human_origin: "manual".into(),
    };
    l.store.enroll_selected_turns(&selection)?;
    assert_eq!(l.remember()?[0].samples, 1);
    assert_eq!(l.active()?, 1);

    let mut l = library()?;
    let assignment = l.confirm(&l.person.clone())?;
    let failed = l
        .store
        .remember_voices(&l.meeting, Err(anyhow::anyhow!("raw checksum or length mismatch")))?;
    assert_eq!(failed[0].state, "failed");
    let voice = l.voice()?.unwrap();
    assert_eq!(voice.state, "failed");
    assert_eq!(
        voice.error.as_deref(),
        Some("raw checksum or length mismatch")
    );
    assert_eq!(l.store.next_voice_meeting(&BTreeSet::new())?, None);
    assert_eq!(
        l.store.voice_memory(&l.person)?["failed"][0]["assignmentId"],
        json!(assignment)
    );
    assert_eq!(
        l.store.processing_report_by_job(&l.job)?.assignments[0].state,
        "confirmed",
        "a failure keeps the confirmation"
    );
    l.store.retry_voice(&assignment)?;
    assert!(l.store.retry_voice(&assignment).is_err());
    assert_eq!(l.remember()?[0].state, "enrolled");
    Ok(())
}

#[test]
fn a_speaker_without_eligible_turns_fails_visibly() -> Result<()> {
    let mut l = library()?;
    l.store.profiles.execute(
        "DELETE FROM processed_candidate WHERE turn_id<>'short'",
        [],
    )?;
    l.confirm(&l.person.clone())?;
    let outcome = l.remember()?;
    assert_eq!(outcome[0].state, "failed");
    assert_eq!(outcome[0].error.as_deref(), Some("no eligible voice samples"));
    assert_eq!(l.active()?, 0);
    Ok(())
}

#[test]
fn a_correction_is_remembered_again_for_the_new_person() -> Result<()> {
    let mut l = library()?;
    l.confirm(&l.person.clone())?;
    l.remember()?;
    let other = l.store.create_person("Someone else", &[], "test consent")?;
    l.confirm(&other)?;
    assert_eq!(l.voice()?.unwrap().state, "pending");
    assert_eq!(l.remember()?[0].samples, PER_CONFIRMATION);
    let owners: i64 = l.store.profiles.query_row(
        "SELECT count(DISTINCT s.person_id) FROM voice_sample s JOIN assignment a ON a.id=s.assignment_id AND a.revision=s.assignment_revision WHERE s.revoked=0",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(owners, 1, "samples of the old revision no longer count");
    Ok(())
}

#[test]
fn forgetting_a_voice_stops_remembering_it() -> Result<()> {
    let mut l = library()?;
    l.confirm(&l.person.clone())?;
    l.remember()?;
    assert!(l.store.forget_voice(&l.person, " ").is_err());
    assert_eq!(l.store.forget_voice(&l.person, "asked to forget")?, 16);
    assert_eq!(l.active()?, 0);
    let memory = l.store.voice_memory(&l.person)?;
    assert_eq!((memory["off"].clone(), memory["pending"].clone()), (json!(true), json!(0)));
    // A new decision for the same person is not remembered while off.
    let other = l.store.create_person("Other", &[], "test consent")?;
    l.confirm(&other)?;
    l.confirm(&l.person.clone())?;
    assert_eq!(l.voice()?.unwrap().state, "off");
    assert_eq!(l.store.next_voice_meeting(&BTreeSet::new())?, None);
    assert!(l.remember()?.is_empty());
    l.store.remember_voice_again(&l.person)?;
    assert_eq!(l.store.voice_memory(&l.person)?["off"], json!(false));
    assert_eq!(l.remember()?[0].samples, PER_CONFIRMATION);
    Ok(())
}

#[test]
fn a_rejected_speaker_is_never_remembered() -> Result<()> {
    let mut l = library()?;
    let id = l.store.reject_processed_track_speaker(
        &l.job,
        "speaker-0",
        Some("mic"),
        "not a participant",
    )?;
    let report = l.store.processing_report_by_job(&l.job)?;
    let a = &report.assignments[0];
    assert_eq!((a.state.as_str(), a.person_id.as_ref(), a.voice.as_ref()), ("rejected", None, None));
    assert_eq!(l.store.next_voice_meeting(&BTreeSet::new())?, None);
    assert!(l.remember()?.is_empty());
    assert!(l
        .store
        .reject_processed_track_speaker(&l.job, "unknown", Some("mic"), "noise")
        .is_err());
    l.store.decide_assignment(&id, None, "revoked", "undo")?;
    assert_eq!(
        l.store.processing_report_by_job(&l.job)?.assignments[0].state,
        "revoked"
    );
    Ok(())
}
