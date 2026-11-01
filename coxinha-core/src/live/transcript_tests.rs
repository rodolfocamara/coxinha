use super::{
    fake::{record, spawn, speech, texts, wait_until, Probe},
    read_transcript, EndState, LiveSegment,
};
use crate::{capture::Track, store::Store};
use anyhow::Result;
use std::sync::Arc;

fn segment(track: Track, start_frame: u64, start_ms: u64, text: &str) -> LiveSegment {
    LiveSegment {
        track,
        start_frame,
        end_frame: start_frame + 480_000,
        start_ms,
        end_ms: start_ms + 300,
        text: text.into(),
    }
}

#[test]
fn reader_drops_a_partial_line_and_duplicate_windows_and_sorts() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let meeting = uuid::Uuid::new_v4().to_string();
    assert!(read_transcript(dir.path(), &meeting)?.is_empty());
    assert!(read_transcript(dir.path(), "../escape").is_err());
    let live = dir.path().join("raw").join(&meeting).join("outputs/live");
    std::fs::create_dir_all(&live)?;
    let mut body = Vec::new();
    for s in [
        segment(Track::Output, 0, 900, "late"),
        segment(Track::Mic, 0, 100, "first"),
        segment(Track::Mic, 0, 100, "duplicate window"),
        segment(Track::Mic, 480_000, 900, "tie"),
    ] {
        body.extend(serde_json::to_vec(&s)?);
        body.push(b'\n');
    }
    body.extend(br#"{"track":"Mic","startFrame":960000,"endF"#);
    std::fs::write(live.join("transcript.jsonl"), body)?;
    let read: Vec<_> = read_transcript(dir.path(), &meeting)?
        .into_iter()
        .map(|s| s.text)
        .collect();
    assert_eq!(read, ["first", "tie", "late"]);
    Ok(())
}

/// A crash after an append, mid-way through the next line, then "Transcrever
/// o resto": the resumed transcript equals an uninterrupted run.
#[test]
fn resume_after_a_crash_mid_append_neither_loses_nor_repeats() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path())?;
    let bursts: Vec<(u32, f64)> = (0..40).map(|n| (n, 0.2 + n as f64 * 0.93)).collect();
    let mic = speech(&bursts, 40.0);
    let output = speech(&[(70, 3.0), (71, 33.3)], 40.0);
    let meeting = record(&store, &mic, &output, true)?;
    let probe = Arc::new(Probe::default());
    let live = spawn(&store, &probe);
    live.enqueue(&meeting);
    live.end(&meeting, EndState::Finished);
    wait_until("first drain", || !live.is_busy());
    let full = read_transcript(&store.root, &meeting)?;
    let expected: Vec<String> = (0..40).map(|n| format!("w{n}")).collect();
    assert_eq!(texts(&full, Track::Mic), expected);
    assert_eq!(texts(&full, Track::Output), ["w70", "w71"]);
    assert!(full.iter().filter(|s| s.track == Track::Mic).count() >= 3);

    let path = store
        .root
        .join("raw")
        .join(&meeting)
        .join("outputs/live/transcript.jsonl");
    let bytes = std::fs::read(&path)?;
    let lines: Vec<&[u8]> = bytes.split_inclusive(|b| *b == b'\n').collect();
    let mut crashed = lines[..2].concat();
    crashed.extend(lines[1]); // appended twice: fsync raced the crash
    crashed.extend(&lines[2][..lines[2].len() / 2]);
    std::fs::write(&path, crashed)?;
    let mut head = lines[..2]
        .iter()
        .map(|l| serde_json::from_slice::<LiveSegment>(l))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    head.sort_by_key(|s| (s.start_ms, s.track));
    assert_eq!(read_transcript(&store.root, &meeting)?, head);

    live.enqueue(&meeting);
    live.end(&meeting, EndState::Finished);
    wait_until("resume", || !live.is_busy());
    assert_eq!(read_transcript(&store.root, &meeting)?, full);
    let healed = std::fs::read(&path)?;
    assert!(healed.ends_with(b"\n"));
    assert!(healed
        .split(|b| *b == b'\n')
        .filter(|l| !l.is_empty())
        .all(|l| serde_json::from_slice::<LiveSegment>(l).is_ok()));
    Ok(())
}

/// Review S1: silence markers move a track forward without showing as text.
#[test]
fn silence_markers_advance_progress_but_are_hidden() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let meeting = uuid::Uuid::new_v4().to_string();
    let live = dir.path().join("raw").join(&meeting).join("outputs/live");
    std::fs::create_dir_all(&live)?;
    let mut body = Vec::new();
    for s in [
        segment(Track::Mic, 0, 100, "fala"),
        segment(Track::Mic, 480_000, 10_000, ""),
        segment(Track::Output, 0, 0, ""),
    ] {
        body.extend(serde_json::to_vec(&s)?);
        body.push(b'\n');
    }
    std::fs::write(live.join("transcript.jsonl"), body)?;
    let texts: Vec<_> = read_transcript(dir.path(), &meeting)?
        .into_iter()
        .map(|s| s.text)
        .collect();
    assert_eq!(texts, ["fala"]);
    assert_eq!(
        super::transcript_progress(dir.path(), &meeting)?,
        [960_000, 480_000]
    );
    Ok(())
}
