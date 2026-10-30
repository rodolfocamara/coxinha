use super::*;
use crate::{capture::Recording, store::Store};
use std::io::Write;

fn fixture() -> Result<(tempfile::TempDir, Store, String, Recording)> {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path())?;
    let meeting = store.create_meeting("committed reader fixture")?;
    let recording = Recording::start(&store, &meeting, "fixture-mic", "fixture-output")?;
    Ok((dir, store, meeting, recording))
}

#[test]
fn checkpoints_bound_the_reader_and_refresh_is_explicit() -> Result<()> {
    let (_dir, store, meeting, mut recording) = fixture()?;
    recording.write_block(Track::Mic, &[100, -200, 300], 0)?;
    recording.write_block(Track::Output, &[1, 2], 0)?;
    recording.checkpoint()?;
    let mut mic = CommittedTrack::open(&store.root, &meeting, Track::Mic)?;
    let mut output = CommittedTrack::open(&store.root, &meeting, Track::Output)?;
    recording.write_block(Track::Mic, &[400, 500], 1)?;
    assert_eq!(mic.read_frames(0, 3)?, [100, -200, 300]);
    assert_eq!(output.read_frames(0, 2)?, [1, 2]);
    assert!(mic.read_frames(0, 5).is_err());
    assert_eq!(
        CommittedTrack::open(&store.root, &meeting, Track::Mic)?.frames(),
        3
    );
    recording.checkpoint()?;
    assert_eq!(mic.frames(), 3);
    assert!(mic.read_frames(3, 5).is_err());
    let mut refreshed = CommittedTrack::open(&store.root, &meeting, Track::Mic)?;
    assert_eq!(refreshed.read_frames(3, 5)?, [400, 500]);
    assert!(refreshed.read_frames(5, 4).is_err());
    assert!(refreshed.read_frames(0, u64::MAX).is_err());
    Ok(())
}

#[test]
fn reader_offset_and_prefix_are_independent_of_concurrent_writer() -> Result<()> {
    let (_dir, store, meeting, mut recording) = fixture()?;
    recording.write_block(Track::Mic, &[17; 4096], 0)?;
    recording.checkpoint()?;
    let mut reader = CommittedTrack::open(&store.root, &meeting, Track::Mic)?;
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let writer_barrier = barrier.clone();
    let writer = std::thread::spawn(move || -> Result<()> {
        for n in 1..=20 {
            writer_barrier.wait();
            recording.write_block(Track::Mic, &[n; 4096], n as u64)?;
            recording.checkpoint()?;
            writer_barrier.wait();
        }
        Ok(())
    });
    for _ in 0..20 {
        barrier.wait();
        let result = reader.read_frames(0, 4096);
        barrier.wait();
        assert_eq!(result?, [17; 4096]);
        assert_eq!(reader.frames(), 4096);
    }
    writer.join().unwrap()?;
    let mut refreshed = CommittedTrack::open(&store.root, &meeting, Track::Mic)?;
    assert_eq!(refreshed.frames(), 21 * 4096);
    assert_eq!(refreshed.read_frames(20 * 4096, 21 * 4096)?, [20; 4096]);
    Ok(())
}

#[test]
fn header_rewrites_do_not_change_the_committed_prefix_or_recovery() -> Result<()> {
    let (_dir, store, meeting, mut recording) = fixture()?;
    recording.write_block(Track::Mic, &[7, 8, 9], 0)?;
    recording.write_block(Track::Output, &[10], 0)?;
    recording.checkpoint()?;
    let mut reader = CommittedTrack::open(&store.root, &meeting, Track::Mic)?;
    let path = store.root.join("raw").join(&meeting).join("mic.wav");
    let mut header = std::fs::OpenOptions::new().write(true).open(&path)?;
    header.write_all(&[0; 44])?;
    assert_eq!(reader.read_frames(0, 3)?, [7, 8, 9]);
    assert_eq!(
        CommittedTrack::open(&store.root, &meeting, Track::Mic)?.read_frames(0, 3)?,
        [7, 8, 9]
    );
    recording.write_block(Track::Mic, &[11], 1)?;
    drop(recording);
    let recovered = store.recover_capture(&meeting)?;
    assert_eq!(recovered.tracks[0].frames, 4);
    assert_eq!(reader.read_frames(0, 3)?, [7, 8, 9]);
    assert!(reader.read_frames(0, 4).is_err());
    Ok(())
}

#[test]
fn long_sparse_track_is_read_in_bounded_windows() -> Result<()> {
    let (_dir, store, meeting, recording) = fixture()?;
    drop(recording);
    let directory = store.root.join("raw").join(&meeting);
    let path = directory.join("manifest.json");
    let mut manifest: CaptureManifest = serde_json::from_reader(File::open(&path)?)?;
    let frames = 2 * 60 * 60 * 48000;
    manifest.tracks[0].frames = frames;
    let raw = std::fs::OpenOptions::new()
        .write(true)
        .open(directory.join("mic.wav"))?;
    raw.set_len(44 + frames * 2)?;
    std::fs::write(&path, serde_json::to_vec(&manifest)?)?;
    let mut reader = CommittedTrack::open(&store.root, &meeting, Track::Mic)?;
    assert_eq!(reader.frames(), frames);
    assert!(reader.read_frames(0, MAX_READ_FRAMES + 1).is_err());
    let mut cursor = 0;
    while cursor < frames {
        let end = (cursor + 30 * 48000).min(frames);
        let samples = reader.read_frames(cursor, end)?;
        assert_eq!(samples.len() as u64, end - cursor);
        assert!(samples.iter().all(|s| *s == 0));
        cursor = end;
    }
    assert_eq!(cursor, frames);
    Ok(())
}

#[test]
fn truncated_ranges_fail_even_after_open() -> Result<()> {
    let (_dir, store, meeting, mut recording) = fixture()?;
    recording.write_block(Track::Mic, &[3; 10], 0)?;
    recording.checkpoint()?;
    let mut reader = CommittedTrack::open(&store.root, &meeting, Track::Mic)?;
    let raw = store.root.join("raw").join(&meeting).join("mic.wav");
    std::fs::OpenOptions::new()
        .write(true)
        .open(raw)?
        .set_len(48)?;
    assert!(reader.read_frames(0, 10).is_err());
    assert!(CommittedTrack::open(&store.root, &meeting, Track::Mic).is_err());
    Ok(())
}

#[test]
fn invalid_layouts_lengths_and_manifests_are_rejected() -> Result<()> {
    let (_dir, store, meeting, recording) = fixture()?;
    drop(recording);
    let path = store.root.join("raw").join(&meeting).join("manifest.json");
    let original: serde_json::Value = serde_json::from_reader(File::open(&path)?)?;
    for (field, value) in [
        ("version", serde_json::json!(2)),
        (
            "meeting",
            serde_json::json!(uuid::Uuid::new_v4().to_string()),
        ),
        ("sample_rate", serde_json::json!(16000)),
        ("state", serde_json::json!("unrecognized")),
    ] {
        let mut invalid = original.clone();
        invalid[field] = value;
        std::fs::write(&path, serde_json::to_vec(&invalid)?)?;
        assert!(CommittedTrack::open(&store.root, &meeting, Track::Mic).is_err());
    }
    for value in [serde_json::json!(u64::MAX), serde_json::json!(u32::MAX)] {
        let mut invalid = original.clone();
        invalid["tracks"][0]["frames"] = value;
        std::fs::write(&path, serde_json::to_vec(&invalid)?)?;
        assert!(CommittedTrack::open(&store.root, &meeting, Track::Mic).is_err());
    }
    let mut invalid = original;
    invalid["tracks"][1]["file"] = serde_json::json!("../other.wav");
    std::fs::write(&path, serde_json::to_vec(&invalid)?)?;
    assert!(CommittedTrack::open(&store.root, &meeting, Track::Mic).is_err());
    std::fs::write(path, vec![b' '; MANIFEST_LIMIT as usize + 1])?;
    assert!(CommittedTrack::open(&store.root, &meeting, Track::Mic).is_err());
    assert!(CommittedTrack::open(&store.root, "../other", Track::Mic).is_err());
    Ok(())
}

#[cfg(unix)]
#[test]
fn symlink_tracks_are_rejected() -> Result<()> {
    let (_dir, store, meeting, recording) = fixture()?;
    drop(recording);
    let directory = store.root.join("raw").join(&meeting);
    std::fs::remove_file(directory.join("mic.wav"))?;
    std::os::unix::fs::symlink(directory.join("output.wav"), directory.join("mic.wav"))?;
    assert!(CommittedTrack::open(&store.root, &meeting, Track::Mic).is_err());
    Ok(())
}
