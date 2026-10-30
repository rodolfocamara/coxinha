use super::*;
#[test]
fn inventory_revision_revocation_history_unknown_fields_and_privacy_backup() -> Result<()> {
    let (d, mut store, _, meeting, s) = fixture()?;
    let enrolled = store.enroll_selected_turns(&s)?;
    let id = enrolled["sampleIds"][0].as_str().unwrap();
    let profiles = store.voice_profiles()?;
    assert_eq!(profiles["profiles"][0]["spaces"][0]["activeCount"], 1);
    assert_eq!(
        profiles["profiles"][0]["spaces"][0]["activeDurationMs"],
        200
    );
    store.profiles.execute("UPDATE voice_sample SET provenance_json=json_set(provenance_json,'$.futurePrivate',json('{\"a\":42}'))",[])?;
    assert!(store
        .revoke_voice_sample(&uuid::Uuid::new_v4().to_string(), id, "human")
        .is_err());
    assert!(store.revoke_voice_sample(&s.person_id, id, "").is_err());
    store.revoke_voice_sample(&s.person_id, id, "private revoke marker")?;
    store.revoke_voice_sample(&s.person_id, id, "second actual human event")?;
    let p: String =
        store
            .profiles
            .query_row("SELECT provenance_json FROM voice_sample", [], |r| r.get(0))?;
    let value: Value = serde_json::from_str(&p)?;
    assert_eq!(value["futurePrivate"]["a"], 42);
    assert_eq!(value["curationRevocations"].as_array().unwrap().len(), 2);
    let legacy: SampleProvenance = serde_json::from_str(&p)?;
    assert_eq!(legacy.start_ms, 0);
    let samples = store.person_samples(&s.person_id)?;
    assert_eq!(samples["samples"][0]["state"], "revoked");
    assert!(samples["samples"][0]["revokedAt"].is_string());
    let projection = serde_json::to_string(&samples)?;
    for secret in [
        "vector",
        "private revoke marker",
        "private consent marker",
        "futurePrivate",
        "quality_note",
    ] {
        assert!(!projection.contains(secret));
    }
    assert_eq!(store.voice_profiles()?["profiles"][0]["revokedCount"], 1);
    // Old dedupe readers ignore the additive audit; revoked intervals can be enrolled again.
    store.enroll_selected_turns(&s)?;
    store.decide_assignment(
        &s.assignment_id,
        Some(&s.person_id),
        "confirmed",
        "correction",
    )?;
    assert_eq!(
        store.voice_profiles()?["profiles"][0]["invalidatedCount"],
        1
    );
    assert_eq!(store.voice_profiles()?["profiles"][0]["spaces"], json!([]));
    let export = d.path().join("export");
    store.export_meeting(&meeting, &export)?;
    for entry in std::fs::read_dir(export)? {
        let path = entry?.path();
        if path.extension().is_some_and(|x| x == "json") {
            let text = std::fs::read_to_string(path)?;
            for secret in [
                "curationRevocations",
                "private revoke marker",
                "private consent marker",
                "vector_json",
                "futurePrivate",
            ] {
                assert!(!text.contains(secret));
            }
        }
    }
    let backup = d.path().join("backup");
    store.backup(&backup)?;
    let restored = Store::open(&backup)?;
    let retained: String = restored.profiles.query_row(
        "SELECT provenance_json FROM voice_sample WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    assert_eq!(retained, p);
    assert_eq!(count(&restored)?, 2);
    Ok(())
}
#[test]
fn legacy_revoke_has_unknown_date_and_trackless_assignment_revoke_still_works() -> Result<()> {
    let (_d, mut store, _, meeting, s) = fixture()?;
    let id = store.enroll_selected_turns(&s)?["sampleIds"][0]
        .as_str()
        .unwrap()
        .to_string();
    store.revoke_sample(&id)?;
    assert_eq!(
        store.person_samples(&s.person_id)?["samples"][0]["revokedAt"],
        Value::Null
    );
    store.enroll_selected_turns(&s)?;
    assert_eq!(count(&store)?, 2);
    assert_eq!(
        store.voice_profiles()?["profiles"][0]["spaces"][0]["activeCount"],
        1,
        "legacy revocation permits explicit reenrollment without reconfirmation"
    );
    let legacy =
        store.suggest_assignment(&meeting, "legacy-trackless-label", Some(&s.person_id))?;
    store.decide_assignment(&legacy, None, "revoked", "legacy command")?;
    Ok(())
}
