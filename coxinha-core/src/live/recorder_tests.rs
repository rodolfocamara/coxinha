use super::{
    fake::{spawn, speech, texts, wait_until, Probe},
    read_transcript, EndState,
};
use crate::{
    capture::{Recording, Track},
    store::Store,
};
use anyhow::Result;
use std::sync::Arc;

const PAUSE: std::ops::Range<f64> = 30.0..38.0;

fn bursts(first_id: u32, count: u32, offset: f64, spacing: f64) -> Vec<(u32, f64)> {
    (0..count)
        .map(|n| (first_id + n, offset + n as f64 * spacing))
        .filter(|(_, t)| !(PAUSE.start - 0.4..PAUSE.end).contains(t))
        .collect()
}

/// The real recorder writes both tracks, pauses for 8 s, and checkpoints both
/// synchronously and on its background thread while the worker reads.
#[test]
fn live_transcript_follows_a_real_recording_with_concurrent_checkpoints() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path())?;
    let meeting = store.create_meeting("real recorder")?;
    let mut recording = Recording::start(&store, &meeting, "fixture-mic", "fixture-output")?;
    let probe = Arc::new(Probe::default());
    let live = spawn(&store, &probe);
    live.enqueue(&meeting);
    let mic_bursts = bursts(0, 60, 0.4, 1.13);
    let output_bursts = bursts(70, 25, 0.9, 2.71);
    let mic = speech(&mic_bursts, 70.0);
    let output = speech(&output_bursts, 70.0);
    for (n, (a, b)) in mic.chunks(960).zip(output.chunks(960)).enumerate() {
        let fed = (n * 960) as f64 / 48_000.0;
        let arrival = n as u64 * 20_000_000;
        if fed == PAUSE.start {
            recording.pause(true, arrival)?;
        } else if fed == PAUSE.end {
            recording.pause(false, arrival)?;
        }
        recording.write_block(Track::Mic, a, arrival)?;
        recording.write_block(Track::Output, b, arrival)?;
        if n % 25 == 0 {
            recording.request_checkpoint()?;
            live.committed(&meeting);
        }
        if n % 400 == 0 {
            recording.checkpoint()?;
            live.committed(&meeting);
        }
    }
    recording.finish(&store, false)?;
    live.end(&meeting, EndState::Finished);
    wait_until("drain", || !live.is_busy());
    assert_eq!(live.snapshot().state, "idle");

    let segments = read_transcript(&store.root, &meeting)?;
    for (track, expected) in [(Track::Mic, &mic_bursts), (Track::Output, &output_bursts)] {
        let ids: Vec<String> = expected.iter().map(|(id, _)| format!("w{id}")).collect();
        assert_eq!(texts(&segments, track), ids);
    }
    let boundary = (PAUSE.start * 48_000.0) as u64;
    let time_of = |word: &str| {
        mic_bursts
            .iter()
            .chain(&output_bursts)
            .find(|(id, _)| format!("w{id}") == word)
            .map(|(_, t)| t * 1000.0)
            .unwrap()
    };
    for s in &segments {
        assert!(
            s.end_frame <= boundary || s.start_frame >= boundary,
            "window crosses the pause"
        );
        let words: Vec<&str> = s.text.split(' ').collect();
        // Capture clock: paused frames are added back after the boundary.
        let start = time_of(words[0]);
        let end = time_of(words[words.len() - 1]) + super::fake::BURST_S * 1000.0;
        assert!((s.start_ms as f64 - start).abs() <= 2.0, "{s:?} vs {start}");
        assert!((s.end_ms as f64 - end).abs() <= 2.0, "{s:?} vs {end}");
    }
    Ok(())
}
