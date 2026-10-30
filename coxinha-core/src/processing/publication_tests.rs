use super::{
    publication::FAIL_AT,
    tests::{fixture, output},
};
use crate::store::Store;
use anyhow::Result;

fn pending(store: &Store) -> Result<i64> {
    Ok(store
        .profiles
        .query_row("SELECT count(*) FROM processing_publication", [], |r| {
            r.get(0)
        })?)
}
fn artifacts(store: &Store, job: &str) -> Result<i64> {
    Ok(store.db.query_row(
        "SELECT count(*) FROM artifact WHERE job_id=?1",
        [job],
        |r| r.get(0),
    )?)
}
#[test]
fn each_durable_boundary_resumes_exact_delivery_without_duplicate_artifacts() -> Result<()> {
    for phase in ["private", "file", "artifact", "public"] {
        let (dir, mut store, meeting, config) = fixture()?;
        let input = store.prepare_processing(&meeting, &config)?;
        let raw: Vec<_> = input
            .tracks
            .iter()
            .map(|t| crate::artifacts::digest(&t.path).unwrap())
            .collect();
        store.edit(
            &meeting,
            &format!("{}:segment", input.job),
            "retain this correction",
        )?;
        assert!(store.claim(&input.job)?);
        FAIL_AT.with(|point| point.set(phase));
        assert!(store
            .commit_processing(&input, output())
            .unwrap_err()
            .to_string()
            .contains(phase));
        assert_eq!(pending(&store)?, 1);
        let root = store.root.clone();
        drop(store);
        let mut store = Store::open(root)?;
        store.recover_jobs()?;
        if store.job_state(&input.job)? != "succeeded" {
            assert!(store.claim(&input.job)?);
        }
        assert!(store.resume_processing_publication(&input)?);
        assert!(!store.resume_processing_publication(&input)?);
        assert_eq!(pending(&store)?, 0);
        assert_eq!(artifacts(&store, &input.job)?, 1);
        assert_eq!(store.job_state(&input.job)?, "succeeded");
        let report = store.processing_report(&meeting)?;
        assert_eq!(report.segments[0].id, "segment");
        assert_eq!(report.turns[0].id, "turn");
        assert_eq!(report.corrections["segment"], "retain this correction");
        for (track, expected) in input.tracks.iter().zip(&raw) {
            assert_eq!(&crate::artifacts::digest(&track.path)?, expected);
        }
        store.verify_artifacts(&meeting)?;
        let public = std::fs::read_to_string(
            store
                .root
                .join(format!("raw/{meeting}/outputs/{}.json", input.job)),
        )?;
        assert!(!public.contains("embedding"));
        assert!(!public.contains("model_hash"));
        assert!(!public.contains(config.models["fixture"].path.to_str().unwrap()));
        let export = dir.path().join("export");
        store.export_meeting(&meeting, &export)?;
        assert!(!export.join("private").exists());
        assert!(std::fs::read_to_string(export.join("transcript.json"))?
            .contains("retain this correction"));
    }
    Ok(())
}

#[test]
fn conflicting_files_rows_and_changed_sources_are_preserved() -> Result<()> {
    for conflict in ["file", "row", "source"] {
        let (_dir, mut store, meeting, config) = fixture()?;
        let input = store.prepare_processing(&meeting, &config)?;
        store.claim(&input.job)?;
        FAIL_AT.with(|point| point.set("private"));
        assert!(store.commit_processing(&input, output()).is_err());
        let path = store
            .root
            .join(format!("raw/{meeting}/outputs/{}.json", input.job));
        std::fs::create_dir_all(path.parent().unwrap())?;
        if conflict == "file" {
            std::fs::write(&path, b"retain conflicting derived file")?;
        }
        if conflict == "row" {
            store.db.execute("INSERT INTO artifact(id,meeting_id,job_id,relative_path,sha256,bytes) VALUES(?1,?2,?1,'conflict','bad',3)", rusqlite::params![input.job, meeting])?;
        }
        if conflict == "source" {
            std::fs::write(&input.tracks[0].path, b"changed source")?;
        }
        assert!(
            store.resume_processing_publication(&input).is_err(),
            "{conflict}"
        );
        assert_eq!(pending(&store)?, 1);
        assert_eq!(store.job_state(&input.job)?, "running");
        if conflict == "file" {
            assert_eq!(std::fs::read(path)?, b"retain conflicting derived file");
        }
        if conflict == "row" {
            assert_eq!(
                store.db.query_row(
                    "SELECT sha256 FROM artifact WHERE id=?1",
                    [&input.job],
                    |r| r.get::<_, String>(0)
                )?,
                "bad"
            );
        }
    }
    Ok(())
}

#[test]
fn invalid_candidates_and_intent_insert_failure_roll_back_together() -> Result<()> {
    let (_dir, mut store, meeting, config) = fixture()?;
    let input = store.prepare_processing(&meeting, &config)?;
    store.claim(&input.job)?;
    let mut invalid = output();
    invalid.turns[0].embedding = Some(vec![0., 0.]);
    assert!(store.commit_processing(&input, invalid).is_err());
    assert_eq!(pending(&store)?, 0);
    store.profiles.execute_batch("CREATE TRIGGER fail_intent BEFORE INSERT ON processing_publication BEGIN SELECT RAISE(FAIL,'synthetic intent failure'); END;")?;
    assert!(store.commit_processing(&input, output()).is_err());
    assert_eq!(pending(&store)?, 0);
    assert_eq!(
        store
            .profiles
            .query_row("SELECT count(*) FROM processed_candidate", [], |r| r
                .get::<_, i64>(0))?,
        0
    );
    assert_eq!(artifacts(&store, &input.job)?, 0);
    store.profiles.execute_batch("DROP TRIGGER fail_intent;")?;
    store.commit_processing(&input, output())?;
    Ok(())
}

#[test]
fn backup_carries_private_intent_and_resumes_after_library_relocation() -> Result<()> {
    let (dir, mut store, meeting, config) = fixture()?;
    let input = store.prepare_processing(&meeting, &config)?;
    store.claim(&input.job)?;
    FAIL_AT.with(|point| point.set("artifact"));
    assert!(store.commit_processing(&input, output()).is_err());
    let backup = dir.path().join("backup");
    store.backup(&backup)?;
    let original = store.root.clone();
    drop(store);
    std::fs::rename(&original, dir.path().join("unavailable-original"))?;
    let mut restored = Store::open(&backup)?;
    assert_eq!(pending(&restored)?, 1);
    restored.recover_jobs()?;
    let moved = restored.prepare_processing(&meeting, &config)?;
    assert_eq!(moved.job, input.job);
    assert_ne!(moved.tracks[0].path, input.tracks[0].path);
    restored.claim(&moved.job)?;
    assert!(restored.resume_processing_publication(&moved)?);
    assert_eq!(artifacts(&restored, &moved.job)?, 1);
    assert_eq!(pending(&restored)?, 0);
    Ok(())
}

#[test]
fn malformed_intent_cannot_replace_candidates_or_publish() -> Result<()> {
    let (_dir, mut store, meeting, config) = fixture()?;
    let input = store.prepare_processing(&meeting, &config)?;
    store.claim(&input.job)?;
    FAIL_AT.with(|point| point.set("private"));
    assert!(store.commit_processing(&input, output()).is_err());
    store.profiles.execute(
        "UPDATE processing_publication SET result_json='broken' WHERE job_id=?1",
        [&input.job],
    )?;
    assert!(store.resume_processing_publication(&input).is_err());
    assert!(store.commit_processing(&input, output()).is_err());
    assert_eq!(pending(&store)?, 1);
    assert_eq!(artifacts(&store, &input.job)?, 0);
    Ok(())
}

#[test]
fn private_migration_failure_preserves_v3_and_retries_cleanly() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let source =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session-v4/library");
    crate::artifacts::copy_tree(&source, dir.path())?;
    let path = dir.path().join("private/profiles.db");
    let db = rusqlite::Connection::open(&path)?;
    db.execute_batch("CREATE TABLE processing_publication(retained TEXT); INSERT INTO processing_publication VALUES('do not replace');")?;
    drop(db);
    assert!(Store::open(dir.path()).is_err());
    let db = rusqlite::Connection::open(&path)?;
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        3
    );
    assert_eq!(
        db.query_row("SELECT retained FROM processing_publication", [], |r| {
            r.get::<_, String>(0)
        })?,
        "do not replace"
    );
    db.execute_batch("DROP TABLE processing_publication;")?;
    drop(db);
    let store = Store::open(dir.path())?;
    assert_eq!(
        store
            .profiles
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))?,
        4
    );
    assert_eq!(pending(&store)?, 0);
    Ok(())
}

#[test]
#[cfg(unix)]
fn publication_rejects_symlink_files_and_directories_without_external_writes() -> Result<()> {
    for link_directory in [false, true] {
        let (dir, mut store, meeting, config) = fixture()?;
        let input = store.prepare_processing(&meeting, &config)?;
        store.claim(&input.job)?;
        FAIL_AT.with(|point| point.set("private"));
        assert!(store.commit_processing(&input, output()).is_err());
        let outputs = store.root.join(format!("raw/{meeting}/outputs"));
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside)?;
        let protected = outside.join("retained.json");
        std::fs::write(&protected, b"retain external content")?;
        if link_directory {
            std::os::unix::fs::symlink(&outside, &outputs)?;
        } else {
            std::fs::create_dir(&outputs)?;
            std::os::unix::fs::symlink(&protected, outputs.join(format!("{}.json", input.job)))?;
        }
        assert!(store.resume_processing_publication(&input).is_err());
        assert_eq!(pending(&store)?, 1);
        assert_eq!(artifacts(&store, &input.job)?, 0);
        assert_eq!(std::fs::read(&protected)?, b"retain external content");
        assert_eq!(std::fs::read_dir(&outside)?.count(), 1);
    }
    Ok(())
}
