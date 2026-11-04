use super::*;
#[test]
fn confirmed_only_unknown_correction_revocation_and_space_isolation() -> Result<()> {
    let d = tempfile::tempdir()?;
    let mut s = Store::open(d.path())?;
    let m = s.create_meeting("first")?;
    let m2 = s.create_meeting("second")?;
    let alice = s.create_person("Fixture A", &[], "test operator")?;
    let bob = s.create_person("Fixture B", &[], "test operator")?;
    let mut space = EmbeddingSpace {
        model: "fixture".into(),
        revision: "v1".into(),
        model_hash: "a".repeat(64),
        preprocessing: "p1".into(),
        dimension: 2,
    };
    let a = s.register_space(&space)?;
    space.preprocessing = "p2".into();
    let b = s.register_space(&space)?;
    assert_ne!(a, b);
    let assignment = s.suggest_assignment(&m, "speaker0", Some(&alice))?;
    let mut recording =
        crate::capture::Recording::start(&s, &m, "synthetic-mic", "synthetic-monitor")?;
    for i in 1..=100 {
        recording.write_block(crate::capture::Track::Mic, &[10; 960], i * 20_000_000)?;
        recording.write_block(crate::capture::Track::Output, &[20; 960], i * 20_000_000)?;
    }
    let manifest = recording.finish(&s, false)?;
    let p = SampleProvenance {
        meeting: m.clone(),
        track: "mic".into(),
        start_ms: 0,
        end_ms: 2000,
        audio_sha256: manifest.tracks[0].sha256.clone().unwrap(),
        device: "synthetic".into(),
        quality_note: "policy fixture only".into(),
    };
    assert!(s.enroll(&assignment, &a, &[1., 0.], &p).is_err());
    s.decide_assignment(&assignment, Some(&alice), "confirmed", "human test action")?;
    let sample = s.enroll(&assignment, &a, &[1., 0.], &p)?;
    assert!(s.enroll(&assignment, &a, &[1., 0.], &p).is_err());
    assert!(s.enroll(&assignment, &a, &[f32::NAN, 0.], &p).is_err());
    assert!(s.enroll(&assignment, &a, &[0., 0.], &p).is_err());
    assert!(s.match_voice(&a, &[1.], None).is_err());
    assert!(matches!(
        s.match_voice(&a, &[1., 0.], None)?,
        MatchResult::Unknown { .. }
    ));
    let c = Calibration {
        space_id: a.clone(),
        evidence: "synthetic policy test; NOT acoustic calibration".into(),
        minimum_samples: 1,
        minimum_duration_ms: 1000,
        cosine_threshold: 0.8,
        candidate_margin: 0.1,
    };
    assert!(
        matches!(s.match_voice(&a,&[1.,0.],Some(&c))?,MatchResult::Suggestion{person_id,..} if person_id==alice)
    );
    assert!(matches!(
        s.match_voice(&a, &[0., 1.], Some(&c))?,
        MatchResult::Unknown { .. }
    ));
    assert!(s.match_voice(&b, &[1., 0.], Some(&c)).is_err());
    let before: i64 = s
        .profiles
        .query_row("SELECT count(*) FROM voice_sample", [], |r| r.get(0))?;
    s.match_voice(&a, &[1., 0.], Some(&c))?;
    assert_eq!(
        s.profiles
            .query_row("SELECT count(*) FROM voice_sample", [], |r| r
                .get::<_, i64>(0))?,
        before
    );
    let derived = s.suggest_assignment(&m2, "derived-speaker", Some(&alice))?;
    assert!(!s.assignment_is_stale(&derived)?);
    s.decide_assignment(
        &assignment,
        Some(&bob),
        "confirmed",
        "corrected by operator",
    )?;
    assert!(matches!(
        s.match_voice(&a, &[1., 0.], Some(&c))?,
        MatchResult::Unknown { .. }
    ));
    assert!(s.assignment_is_stale(&derived)?);
    let new_sample = s.enroll(&assignment, &a, &[1., 0.], &p)?;
    s.revoke_sample(&new_sample)?;
    assert!(matches!(
        s.match_voice(&a, &[1., 0.], Some(&c))?,
        MatchResult::Unknown { .. }
    ));
    s.revoke_sample(&sample)?;
    let rejected = s.suggest_assignment(&m2, "speaker0", Some(&alice))?;
    s.decide_assignment(&rejected, None, "rejected", "operator")?;
    assert!(s.enroll(&rejected, &a, &[1., 0.], &p).is_err());
    Ok(())
}
