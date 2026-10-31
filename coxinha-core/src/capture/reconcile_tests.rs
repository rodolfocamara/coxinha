use super::*;
use crate::{
    capture::{Recording, Track},
    jobs::JobInput,
};

fn state(s: &Store, id: &str) -> String {
    s.db.query_row("SELECT capture_state FROM meeting WHERE id=?1", [id], |r| {
        r.get(0)
    })
    .unwrap()
}
fn orphan(s: &Store, title: &str) -> Result<String> {
    let m = s.create_meeting(title)?;
    let mut r = Recording::start(s, &m, "synthetic-mic", "synthetic-output")?;
    r.write_block(Track::Mic, &[5; 960], 20_000_000)?;
    drop(r);
    Ok(m)
}
fn raw_files(s: &Store, id: &str) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<_> = std::fs::read_dir(s.root.join("raw").join(id))
        .map(|d| {
            d.map(|e| {
                let e = e.unwrap();
                (
                    e.file_name().to_string_lossy().into_owned(),
                    std::fs::read(e.path()).unwrap(),
                )
            })
            .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

#[test]
fn orphan_with_valid_raw_is_recovered_as_interrupted() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let m = orphan(&s, "crashed capture")?;
    let reports = s.reconcile_orphan_captures()?;
    assert_eq!(
        reports,
        vec![OrphanReport {
            meeting: m.clone(),
            error: None
        }]
    );
    assert_eq!(state(&s, &m), "interrupted");
    let manifest = s.recover_capture(&m)?;
    assert_eq!(manifest.state, "interrupted");
    assert_eq!(manifest.tracks[0].frames, 960);
    assert!(manifest.tracks.iter().all(|t| t.sha256.is_some()));
    assert!(s.reconcile_orphan_captures()?.is_empty());
    Ok(())
}

#[test]
fn orphan_with_broken_raw_is_released_but_files_are_untouched() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let partial = orphan(&s, "partial frame")?;
    let mic = s.root.join("raw").join(&partial).join("mic.wav");
    let mut bytes = std::fs::read(&mic)?;
    bytes.push(0);
    std::fs::write(&mic, bytes)?;
    let missing = s.create_meeting("missing manifest")?;
    s.db.execute(
        "UPDATE meeting SET capture_state='recording' WHERE id=?1",
        [&missing],
    )?;
    let before = raw_files(&s, &partial);
    let reports = s.reconcile_orphan_captures()?;
    assert_eq!(reports.len(), 2);
    assert!(reports.iter().all(|r| r.error.is_some()));
    assert_eq!(state(&s, &partial), "interrupted");
    assert_eq!(state(&s, &missing), "interrupted");
    assert_eq!(raw_files(&s, &partial), before);
    assert!(raw_files(&s, &missing).is_empty());
    let manifest: crate::capture::CaptureManifest = serde_json::from_slice(&std::fs::read(
        s.root.join("raw").join(&partial).join("manifest.json"),
    )?)?;
    assert_eq!(manifest.state, "recording");
    // Explicit recovery still sees the untouched manifest and its precise failure.
    let error = s.recover_capture(&partial).unwrap_err().to_string();
    assert!(error.contains("partial PCM frame"), "{error}");
    Ok(())
}

#[test]
fn finished_and_new_rows_are_untouched() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let fresh = s.create_meeting("new")?;
    let done = s.create_meeting("finished")?;
    let mut r = Recording::start(&s, &done, "synthetic-mic", "synthetic-output")?;
    r.write_block(Track::Mic, &[1; 960], 1)?;
    r.write_block(Track::Output, &[2; 960], 1)?;
    r.finish(&s, false)?;
    let before = raw_files(&s, &done);
    assert!(s.reconcile_orphan_captures()?.is_empty());
    assert_eq!(state(&s, &fresh), "new");
    assert_eq!(state(&s, &done), "finished");
    assert_eq!(raw_files(&s, &done), before);
    Ok(())
}

#[test]
fn reconciliation_unblocks_local_processing_claims() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let m = orphan(&s, "blocking orphan")?;
    let job = s.enqueue(
        &m,
        "local-processing",
        &JobInput {
            artifact_sha256: "a".repeat(64),
            config_sha256: "b".repeat(64),
            model_sha256: "c".repeat(64),
            engine_version: "fixture-v1".into(),
        },
    )?;
    assert!(!s.claim(&job)?);
    s.reconcile_orphan_captures()?;
    assert!(s.claim(&job)?);
    Ok(())
}
