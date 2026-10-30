use super::*;
use crate::curation::{CurationError, InventoryPager};
fn error(result: Result<Value>, code: CurationError) {
    assert_eq!(result.unwrap_err().to_string(), code.to_string());
}
fn cursor(page: &Value) -> Option<&str> {
    page["nextCursor"].as_str()
}
fn db_hash(store: &Store) -> Result<(String, String)> {
    Ok((
        crate::artifacts::digest(&store.root.join("meetings.db"))?.0,
        crate::artifacts::digest(&store.root.join("private/profiles.db"))?.0,
    ))
}

#[test]
fn cursor_scope_metadata_external_restart_and_pure_read_invalidation() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let pager = InventoryPager::default();
    let other = store.create_person("Second", &[], "synthetic")?;
    store.enroll_selected_turns(&s)?;
    let first = pager.profiles_page(&store, None, Some(1))?;
    let token = cursor(&first).unwrap();
    assert_eq!(first, pager.profiles_page(&store, None, Some(1))?);
    let decoded = (0..token.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&token[i..i + 2], 16).unwrap())
        .collect::<Vec<_>>();
    let original: Value = serde_json::from_slice(&decoded)?;
    for (key, value) in [
        ("version", json!(1)),
        ("operation", json!("foreign")),
        ("person", json!("foreign")),
        ("after", json!(-1)),
        ("after", original["upper"].clone()),
        ("upper", json!(999999)),
        ("unexpected", json!(true)),
    ] {
        let mut modified = original.clone();
        modified[key] = value;
        let encoded = serde_json::to_vec(&modified)?
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        error(
            pager.profiles_page(&store, Some(&encoded), Some(1)),
            CurationError::Cursor,
        );
    }
    assert!(pager
        .profiles_page(&store, Some(token), Some(1))?
        .get("profiles")
        .is_some());
    let before = generation(&store)?;
    store.create_person("Third", &[], "synthetic")?;
    assert_eq!(generation(&store)?, before);
    error(
        pager.profiles_page(&store, Some(token), Some(1)),
        CurationError::Refresh,
    );
    let fresh = pager.profiles_page(&store, None, Some(1))?;
    store
        .profiles
        .execute("UPDATE person SET name='Edited' WHERE id=?1", [&other])?;
    error(
        pager.profiles_page(&store, cursor(&fresh), Some(1)),
        CurationError::Refresh,
    );
    let fresh = pager.profiles_page(&store, None, Some(1))?;
    let external = rusqlite::Connection::open(store.root.join("private/profiles.db"))?;
    external.execute("UPDATE person SET name='External' WHERE id=?1", [&other])?;
    error(
        pager.profiles_page(&store, cursor(&fresh), Some(1)),
        CurationError::Refresh,
    );
    let fresh = pager.profiles_page(&store, None, Some(1))?;
    error(
        InventoryPager::default().profiles_page(&store, cursor(&fresh), Some(1)),
        CurationError::Refresh,
    );
    error(
        pager.samples_page(&store, &s.person_id, cursor(&fresh), Some(1)),
        CurationError::Cursor,
    );
    for bad in [
        "bad".into(),
        "0".into(),
        "x".repeat(2049),
        "7b7d".into(),
        "c3a9".into(),
    ] {
        error(
            pager.profiles_page(&store, Some(&bad), None),
            CurationError::Cursor,
        );
    }
    error(
        pager.profiles_page(&store, None, Some(0)),
        CurationError::Cursor,
    );
    error(
        pager.samples_page(&store, &other, None, Some(101)),
        CurationError::Cursor,
    );
    Ok(())
}
#[test]
fn retained_history_above_both_caps_is_fully_recoverable_and_read_only() -> Result<()> {
    let (_d, store, _, meeting, s) = fixture()?;
    let pager = InventoryPager::default();
    let sample = store.enroll_selected_turns(&s)?["sampleIds"][0]
        .as_str()
        .unwrap()
        .to_owned();
    store.revoke_voice_sample(&s.person_id, &sample, "synthetic historic revoke")?;
    let second = store.create_person("Interleaved", &[], "synthetic")?;
    let a2 = store.suggest_assignment(&meeting, "legacy-other", Some(&second))?;
    let third = store.create_person("Late person", &[], "synthetic")?;
    let raw: (String, String) = store.profiles.query_row(
        "SELECT space_id,provenance_json FROM voice_sample WHERE id=?1",
        [&sample],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let tx = Transaction::new_unchecked(&store.profiles, TransactionBehavior::Immediate)?;
    for i in 0..8193 {
        let person = if i == 8192 {
            &third
        } else if i % 2 == 0 {
            &s.person_id
        } else {
            &second
        };
        let assignment = if person == &s.person_id {
            &s.assignment_id
        } else {
            &a2
        };
        let mut p: Value = serde_json::from_str(&raw.1)?;
        p["retainedAuditPadding"] = json!("x".repeat(4500));
        p["retainedAuditId"] = json!(i);
        tx.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json,revoked) VALUES(?1,?2,2,?3,?4,'[1,0]',?5,1)",params![format!("history-{i}"),assignment,person,raw.0,serde_json::to_string(&p)?])?;
    }
    tx.commit()?;
    let bytes: i64 = store.profiles.query_row(
        "SELECT sum(length(CAST(provenance_json AS BLOB))) FROM voice_sample",
        [],
        |r| r.get(0),
    )?;
    assert!(bytes > 32 * 1024 * 1024);
    let before = db_hash(&store)?;
    let first = pager.samples_page(&store, &third, None, Some(100))?;
    assert_eq!(first["samples"], json!([]));
    assert_eq!(first["scannedRows"], 4096);
    assert!(cursor(&first).is_some());
    assert_eq!(first, pager.samples_page(&store, &third, None, Some(100))?);
    error(
        pager.samples_page(&store, &second, cursor(&first), None),
        CurationError::Cursor,
    );
    let mut totals = Vec::new();
    for person in [&s.person_id, &second, &third] {
        let mut next = None;
        let mut ids = BTreeSet::new();
        loop {
            let page = pager.samples_page(&store, person, next.as_deref(), Some(100))?;
            assert!(page["scannedRows"].as_u64().unwrap() <= 4096);
            for sample in page["samples"].as_array().unwrap() {
                assert!(ids.insert(sample["sampleId"].as_str().unwrap().to_owned()));
                assert_eq!(sample["state"], "revoked");
            }
            let following = cursor(&page).map(str::to_owned);
            assert!(following.is_none() || following != next);
            next = following;
            if next.is_none() {
                break;
            }
        }
        totals.push(ids.len());
    }
    assert_eq!(totals, vec![4097, 4096, 1]);
    assert_eq!(
        pager.profiles_page(&store, None, None)?["profiles"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(before, db_hash(&store)?);
    assert!(
        store.enrollment_candidates(&s.job, &s.track, &s.speaker)?["turns"][0]["eligible"]
            .as_bool()
            .unwrap()
    );
    store.enroll_selected_turns(&s)?;
    error(
        pager.samples_page(&store, &third, cursor(&first), Some(100)),
        CurationError::Refresh,
    );
    store.revoke_voice_sample(&third, "history-8192", "explicit later event")?;
    assert_eq!(count(&store)?, 8195);
    Ok(())
}
#[test]
fn malformed_or_oversized_target_row_does_not_block_metadata_or_other_person() -> Result<()> {
    let (_d, store, _, _, s) = fixture()?;
    let pager = InventoryPager::default();
    let other = store.create_person("Other", &[], "synthetic")?;
    let id = store.enroll_selected_turns(&s)?["sampleIds"][0]
        .as_str()
        .unwrap()
        .to_owned();
    store.profiles.execute(
        "UPDATE voice_sample SET provenance_json='bad' WHERE id=?1",
        [&id],
    )?;
    error(
        pager.samples_page(&store, &s.person_id, None, None),
        CurationError::InventoryRow,
    );
    assert_eq!(
        pager.samples_page(&store, &other, None, None)?["samples"],
        json!([])
    );
    assert_eq!(
        pager.profiles_page(&store, None, None)?["profiles"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    store.profiles.execute(
        "UPDATE voice_sample SET provenance_json=?1",
        ["x".repeat(1024 * 1024 + 1)],
    )?;
    error(
        pager.samples_page(&store, &s.person_id, None, None),
        CurationError::InventoryRow,
    );
    Ok(())
}
