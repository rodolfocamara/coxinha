use super::*;

#[test]
fn windows_spread_over_the_meeting_and_stay_inside_each_turn() {
    let many: Vec<_> = (0..100).map(|i| (i * 10_000, i * 10_000 + 6_000)).collect();
    let windows = level_windows(&many);
    assert_eq!(windows.len(), LEVEL_TURNS);
    assert_eq!(windows[0], (2_000, 4_000));
    assert!(windows.last().unwrap().0 > 900_000, "late turns are sampled too");
    assert_eq!(level_windows(&[(1_000, 1_400)]), vec![(1_000, 1_400)]);
    assert!(level_windows(&[(5, 5)]).is_empty());
}

#[test]
fn levels_are_rms_dbfs_and_their_median() {
    assert!(rms_db(&[i16::MAX; 480]).abs() < 0.01);
    assert_eq!(rms_db(&[0; 480]), -120.0);
    assert_eq!(rms_db(&[]), -120.0);
    assert!((rms_db(&[13; 480]) - 20.0 * (13f64 / 32768.0).log10()).abs() < 1e-9);
    assert_eq!(median(vec![-30.0, -60.0, -40.0]), Some(-40.0));
    assert_eq!(median(vec![-30.0, -40.0]), Some(-35.0));
    assert_eq!(median(vec![]), None);
}

#[test]
fn speaker_levels_read_the_microphone_of_named_clusters() -> anyhow::Result<()> {
    let (_d, mut s, m, c) = crate::processing::tests::fixture()?;
    let p = s.prepare_processing(&m, &c)?;
    assert!(s.claim(&p.job)?);
    let mut result = crate::processing::tests::output();
    let mut unknown = result.turns[0].clone();
    unknown.id = "unknown".into();
    unknown.speaker = "unknown".into();
    unknown.embedding = None;
    unknown.space = None;
    result.turns.push(unknown);
    s.commit_processing(&p, result)?;
    let levels = s.speaker_levels(&p.job)?;
    assert_eq!(levels.len(), 1);
    assert_eq!(levels[0].speaker, "speaker-0");
    assert!((levels[0].level_db - 20.0 * (13f64 / 32768.0).log10()).abs() < 0.01);
    Ok(())
}
