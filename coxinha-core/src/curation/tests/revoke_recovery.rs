use super::*;
use crate::curation::{CurationError, InventoryPager};
fn sample_raw(store: &Store, id: &str) -> Result<(String, bool)> {
    Ok(store.profiles.query_row(
        "SELECT provenance_json,revoked FROM voice_sample WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}
#[test]
fn malformed_nonobject_bad_audit_and_long_audit_revoke_without_loss() -> Result<()> {
    for raw in [
        "invalid { json".to_owned(),
        "[1,2,3]".into(),
        "null".into(),
        "{\"unknown\":42,\"curationRevocations\":{\"old\":true}}".into(),
    ] {
        let (_d, store, _, _, s) = fixture()?;
        let id = store.enroll_selected_turns(&s)?["sampleIds"][0]
            .as_str()
            .unwrap()
            .to_owned();
        store.profiles.execute(
            "UPDATE voice_sample SET provenance_json=?1,vector_json='not-a-vector' WHERE id=?2",
            params![raw, id],
        )?;
        let before = generation(&store)?;
        assert!(store
            .revoke_voice_sample(&uuid::Uuid::new_v4().to_string(), &id, "human")
            .is_err());
        assert_eq!(sample_raw(&store, &id)?, (raw.clone(), false));
        assert_eq!(generation(&store)?, before);
        store.revoke_voice_sample(&s.person_id, &id, "private recovery origin")?;
        let (recovered, revoked) = sample_raw(&store, &id)?;
        assert!(revoked);
        let p: Value = serde_json::from_str(&recovered)?;
        assert_eq!(p["retainedInvalidProvenance"], raw);
        assert_eq!(p["curationRevocations"].as_array().unwrap().len(), 1);
        store.revoke_voice_sample(&s.person_id, &id, "second recovery event")?;
        let p: Value = serde_json::from_str(&sample_raw(&store, &id)?.0)?;
        assert_eq!(p["retainedInvalidProvenance"], raw);
        assert_eq!(p["curationRevocations"].as_array().unwrap().len(), 2);
        let error = InventoryPager::default()
            .samples_page(&store, &s.person_id, None, None)
            .unwrap_err()
            .to_string();
        assert_eq!(error, CurationError::InventoryRow.to_string());
        assert!(!error.contains("private recovery origin"));
        assert!(!error.contains(&raw));
    }
    Ok(())
}
#[test]
fn oversized_valid_object_unknown_fields_and_128_events_preserved_with_rollback() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let id = store.enroll_selected_turns(&s)?["sampleIds"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let mut p: Value = serde_json::from_str(&sample_raw(&store, &id)?.0)?;
    p["unknownFuture"] = json!({"large":"z".repeat(1024*1024+1),"count":42});
    p["curationRevocations"] = json!((0..128).map(|i| json!({"existing":i})).collect::<Vec<_>>());
    let raw = serde_json::to_string(&p)?;
    store.profiles.execute(
        "UPDATE voice_sample SET provenance_json=?1,vector_json='not-a-vector' WHERE id=?2",
        params![raw, id],
    )?;
    let before = generation(&store)?;
    store.profiles.execute_batch("CREATE TRIGGER reject_recovery BEFORE UPDATE ON profile_revision BEGIN SELECT RAISE(FAIL,'synthetic recovery rollback'); END")?;
    assert!(store
        .revoke_voice_sample(&s.person_id, &id, "rollback")
        .is_err());
    assert_eq!(sample_raw(&store, &id)?, (raw.clone(), false));
    assert_eq!(generation(&store)?, before);
    store
        .profiles
        .execute_batch("DROP TRIGGER reject_recovery")?;
    store.revoke_voice_sample(&s.person_id, &id, "real explicit recovery")?;
    let after: Value = serde_json::from_str(&sample_raw(&store, &id)?.0)?;
    for (key, value) in p.as_object().unwrap() {
        if key != "curationRevocations" {
            assert_eq!(&after[key], value);
        }
    }
    let events = after["curationRevocations"].as_array().unwrap();
    assert_eq!(events.len(), 129);
    for i in 0..128 {
        assert_eq!(events[i], p["curationRevocations"][i]);
    }
    assert!(after.get("retainedInvalidProvenance").is_none());
    assert_eq!(generation(&store)?, before + 1);
    store.revoke_voice_sample(&s.person_id, &id, "repeat oversized recovery")?;
    let again: Value = serde_json::from_str(&sample_raw(&store, &id)?.0)?;
    assert_eq!(again["curationRevocations"].as_array().unwrap().len(), 130);
    assert!(again.get("retainedInvalidProvenance").is_none());
    let backup = _d.path().join("backup");
    store.backup(&backup)?;
    let restored = Store::open(&backup)?;
    assert_eq!(sample_raw(&restored, &id)?, sample_raw(&store, &id)?);
    let public = _d.path().join("export");
    store.export_meeting(p["meeting"].as_str().unwrap(), &public)?;
    for entry in std::fs::read_dir(public)? {
        let path = entry?.path();
        if path.extension().is_some_and(|e| e == "json") {
            let text = std::fs::read_to_string(path)?;
            for private in [
                "unknownFuture",
                "real explicit recovery",
                "repeat oversized recovery",
                "retainedInvalidProvenance",
            ] {
                assert!(!text.contains(private));
            }
        }
    }
    Ok(())
}
