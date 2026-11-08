use super::*;
use crate::curation::{CurationError, InventoryPager};
use std::sync::atomic::AtomicBool;
mod comparison;

pub(super) fn history(store: &mut Store, n: usize, dimension: usize, people: usize) -> Result<()> {
    let space = EmbeddingSpace {
        dimension,
        ..result().turns[0].space.clone().unwrap()
    };
    let space = store.register_space(&space)?;
    let meeting = store.create_meeting("synthetic history")?;
    let mut assignments = Vec::new();
    for i in 0..people {
        let p = store.create_person(&format!("Person {i}"), &[], "synthetic")?;
        let a = store.suggest_assignment(&meeting, &format!("history-{i}"), None)?;
        store.decide_assignment(&a, Some(&p), "confirmed", "synthetic")?;
        assignments.push((a, p));
    }
    let tx = store.profiles.transaction()?;
    let mut vector = vec![0f32; dimension];
    vector[0] = 1.;
    let vector = serde_json::to_string(&vector)?;
    for i in 0..n {
        let (a, p) = &assignments[i % people];
        let provenance = SampleProvenance {
            meeting: meeting.clone(),
            track: "mic".into(),
            start_ms: i as u64 * 10,
            end_ms: i as u64 * 10 + 5,
            audio_sha256: "b".repeat(64),
            device: "synthetic".into(),
            quality_note: "synthetic".into(),
        };
        tx.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) VALUES(?1,?2,2,?3,?4,?5,?6)",params![format!("h-{i:06}"),a,p,space,vector,serde_json::to_string(&provenance)?])?;
    }
    tx.commit()?;
    Ok(())
}
pub(super) fn large_query(
    store: &mut Store,
    c: &ProcessingConfig,
    n: usize,
    dimension: usize,
) -> Result<String> {
    let meeting = store.create_meeting("synthetic full-turn query")?;
    let mut r = Recording::start(store, &meeting, "fixture-mic", "fixture-output")?;
    for t in [Track::Mic, Track::Output] {
        for i in 0..60 {
            r.write_block(t, &[27; 4000], (i + 1) * 83_333_334)?;
        }
    }
    r.finish(store, false)?;
    let mut output = result();
    let mut vector = vec![0.; dimension];
    vector[0] = 1.;
    output.turns = (0..n)
        .map(|i| SpeakerTurn {
            id: format!("q-{i:05}"),
            track: if i % 2 == 0 { "mic" } else { "output" }.into(),
            start_ms: (i / 2 * 2) as u64,
            end_ms: (i / 2 * 2 + 1) as u64,
            speaker: format!("s-{}", i % 8),
            embedding: Some(vector.clone()),
            space: Some(EmbeddingSpace {
                dimension,
                ..result().turns[0].space.clone().unwrap()
            }),
        })
        .collect();
    let mut c = c.clone();
    c.engine_version = format!("large-{n}-{dimension}");
    process(store, &meeting, &c, output)
}
#[test]
fn projected_row_and_utf8_byte_admission_rolls_back_every_pending_insert() -> Result<()> {
    let (_d, mut store, _, _, s) = fixture()?;
    history(&mut store, 4095, 2, 1)?;
    let before = generation(&store)?;
    let count_before = count(&store)?;
    // The selected sample itself includes an audit object and UTF-8 byte accounting.
    let mut padded = s.clone();
    padded.human_origin = "é".repeat(500);
    let current:i64=store.profiles.query_row("SELECT sum(length(CAST(vector_json AS BLOB))+length(CAST(provenance_json AS BLOB))) FROM voice_sample",[],|r|r.get(0))?;
    let target: i64 = 32 * 1024 * 1024 - 500;
    let padding = "x".repeat((target - current - 2) as usize);
    store.profiles.execute("UPDATE voice_sample SET provenance_json=json_set(provenance_json,'$.padding',?1) WHERE id='h-000000'",[padding])?;
    let active = active_usage(&store)?;
    assert!(active.1 < 32 * 1024 * 1024);
    assert_eq!(
        store
            .enroll_selected_turns(&padded)
            .unwrap_err()
            .to_string(),
        CurationError::Capacity.to_string()
    );
    assert_eq!(count(&store)?, count_before);
    assert_eq!(generation(&store)?, before);
    assert_eq!(
        store.processing_report_by_job(&s.job)?.assignments[0].state,
        "confirmed"
    );
    // Metadata browsing and target revoke remain usable even above active byte capacity.
    store.profiles.execute("UPDATE voice_sample SET provenance_json=json_set(provenance_json,'$.extra',?1) WHERE id='h-000001'",["z".repeat(2000)])?;
    assert!(active_budget(&store).is_err());
    assert!(InventoryPager::default()
        .profiles_page(&store, None, None)
        .is_ok());
    let person: String = store.profiles.query_row(
        "SELECT person_id FROM voice_sample WHERE id='h-000001'",
        [],
        |r| r.get(0),
    )?;
    store.revoke_voice_sample(&person, "h-000001", "explicit capacity recovery")?;
    assert!(active_budget(&store).is_ok());
    Ok(())
}

#[test]
fn projected_row_capacity_recovers_through_paged_browse_and_target_revoke() -> Result<()> {
    let (_d, mut store, mut c, meeting, mut s) = fixture()?;
    history(&mut store, 4095, 2, 1)?;
    let mut output = result();
    let mut second = output.turns[0].clone();
    second.id = "b".into();
    second.start_ms = 300;
    second.end_ms = 500;
    output.turns.push(second);
    c.engine_version = "row-cap-projection".into();
    s.job = process(&mut store, &meeting, &c, output)?;
    s.assignment_id = store.confirm_processed_track_speaker(
        &s.job,
        &s.speaker,
        Some(&s.track),
        &s.person_id,
        "synthetic",
    )?;
    s.turn_ids = vec!["a".into(), "b".into()];
    let before = generation(&store)?;
    assert_eq!(
        store.enroll_selected_turns(&s).unwrap_err().to_string(),
        CurationError::Capacity.to_string()
    );
    assert_eq!(count(&store)?, 4095);
    assert_eq!(generation(&store)?, before);
    let owner: String = store.profiles.query_row(
        "SELECT person_id FROM voice_sample WHERE id='h-000000'",
        [],
        |r| r.get(0),
    )?;
    let pager = InventoryPager::default();
    assert!(
        !pager.samples_page(&store, &owner, None, Some(1))?["samples"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    store.revoke_voice_sample(&owner, "h-000000", "explicit capacity recovery")?;
    store.enroll_selected_turns(&s)?;
    assert_eq!(active_usage(&store)?.0, 4096);
    // Legacy oversized active stores still have metadata/sample access and a recovery action.
    store.profiles.execute("INSERT INTO voice_sample(id,assignment_id,assignment_revision,person_id,space_id,vector_json,provenance_json) SELECT 'legacy-extra',assignment_id,assignment_revision,person_id,space_id,vector_json,json_set(provenance_json,'$.legacyExtra',1) FROM voice_sample WHERE id='h-000001'",[])?;
    assert!(active_budget(&store).is_err());
    assert!(pager.profiles_page(&store, None, None).is_ok());
    assert!(pager.samples_page(&store, &owner, None, Some(1)).is_ok());
    store.revoke_voice_sample(&owner, "h-000001", "explicit oversized recovery")?;
    assert!(active_budget(&store).is_ok());
    Ok(())
}
