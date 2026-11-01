use super::{
    fake::{record, spawn, speech, texts, wait_until, FakeFactory, Probe},
    read_transcript,
    worker::Tuning,
    EndState, LiveTranscriber,
};
use crate::{
    capture::{Recording, Track},
    store::Store,
};
use anyhow::Result;
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

fn fixture() -> Result<(tempfile::TempDir, Store, Arc<Probe>)> {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path())?;
    Ok((dir, store, Arc::new(Probe::default())))
}

fn short(store: &Store, id: u32, finish: bool) -> Result<String> {
    let pcm = speech(&[(id, 1.0), (id + 1, 4.0)], 6.0);
    record(store, &pcm, &pcm, finish)
}

#[test]
fn a_live_meeting_waits_for_checkpoints_and_closes_on_end() -> Result<()> {
    let (_dir, store, probe) = fixture()?;
    let live = spawn(&store, &probe);
    assert!(!live.is_busy());
    assert_eq!(live.snapshot().state, "idle");
    let meeting = store.create_meeting("live")?;
    let mut r = Recording::start(&store, &meeting, "mic", "output")?;
    live.enqueue(&meeting);
    live.enqueue(&meeting);
    assert!(live.is_busy());
    let pcm = speech(&[(1, 2.0), (2, 13.0)], 15.0);
    for (n, block) in pcm.chunks(4096).enumerate() {
        r.write_block(Track::Mic, block, n as u64)?;
        r.write_block(Track::Output, block, n as u64)?;
    }
    r.checkpoint()?;
    live.committed(&meeting);
    // The first window commits w1; w2 sits in audio a full window has not reached.
    wait_until("first window", || {
        read_transcript(&store.root, &meeting).unwrap().len() == 2
    });
    let snapshot = live.snapshot();
    assert_eq!(snapshot.meeting.as_deref(), Some(meeting.as_str()));
    assert_eq!(snapshot.state, "running");
    assert!(snapshot.behind_ms > 0 && snapshot.behind_ms < 15_000);
    assert!(live.is_busy());
    r.finish(&store, false)?;
    live.end(&meeting, EndState::Finished);
    wait_until("drain", || !live.is_busy());
    let segments = read_transcript(&store.root, &meeting)?;
    assert_eq!(texts(&segments, Track::Mic), ["w1", "w2"]);
    assert_eq!(texts(&segments, Track::Output), ["w1", "w2"]);
    assert_eq!(live.snapshot().state, "idle");
    assert_eq!(probe.loads.load(Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn interrupted_and_failed_ends_are_terminal() -> Result<()> {
    let (_dir, store, probe) = fixture()?;
    let live = spawn(&store, &probe);
    // Interrupted: the capture never finished, only a checkpoint exists.
    let interrupted = short(&store, 10, false)?;
    live.enqueue(&interrupted);
    live.end(&interrupted, EndState::Interrupted);
    wait_until("interrupted drain", || !live.is_busy());
    assert_eq!(
        texts(&read_transcript(&store.root, &interrupted)?, Track::Mic),
        ["w10", "w11"]
    );
    // Failed with no capture at all: the meeting fails and the slot frees.
    let missing = uuid::Uuid::new_v4().to_string();
    live.enqueue(&missing);
    live.end(&missing, EndState::Failed);
    wait_until("failed meeting", || !live.is_busy());
    let snapshot = live.snapshot();
    assert_eq!(snapshot.state, "failed");
    assert_eq!(snapshot.meeting.as_deref(), Some(missing.as_str()));
    assert!(snapshot.error.is_some());
    // Failed after a normal recording still drains what was committed.
    let failed = short(&store, 20, false)?;
    live.enqueue(&failed);
    live.end(&failed, EndState::Failed);
    wait_until("failed drain", || !live.is_busy());
    assert_eq!(
        texts(&read_transcript(&store.root, &failed)?, Track::Output),
        ["w20", "w21"]
    );
    assert_eq!(live.snapshot().state, "idle");
    // An End for a meeting that is not queued is ignored.
    live.end(&failed, EndState::Finished);
    assert!(!live.is_busy());
    Ok(())
}

#[test]
fn meetings_drain_in_fifo_order_with_one_model_load() -> Result<()> {
    let (_dir, store, probe) = fixture()?;
    let first = short(&store, 1, true)?;
    let second = short(&store, 5, true)?;
    probe.set_hold(true);
    let live = spawn(&store, &probe);
    live.enqueue(&first);
    live.enqueue(&second);
    live.end(&first, EndState::Finished);
    wait_until("first window in flight", || {
        probe.runs.load(Ordering::SeqCst) == 1
    });
    let snapshot = live.snapshot();
    assert_eq!(snapshot.meeting.as_deref(), Some(first.as_str()));
    assert_eq!(snapshot.state, "draining");
    assert_eq!(snapshot.queued, std::slice::from_ref(&second));
    live.end(&second, EndState::Finished);
    probe.set_hold(false);
    wait_until("both drained", || !live.is_busy());
    assert_eq!(probe.loads.load(Ordering::SeqCst), 1);
    for (meeting, words) in [(&first, ["w1", "w2"]), (&second, ["w5", "w6"])] {
        assert_eq!(
            texts(&read_transcript(&store.root, meeting)?, Track::Mic),
            words
        );
    }
    Ok(())
}

#[test]
fn load_and_decode_failures_fail_one_meeting_and_the_next_one_runs() -> Result<()> {
    let (_dir, store, probe) = fixture()?;
    let broken = short(&store, 1, true)?;
    let next = short(&store, 3, true)?;
    probe.fail_load.store(true, Ordering::SeqCst);
    let live = spawn(&store, &probe);
    live.enqueue(&broken);
    live.end(&broken, EndState::Finished);
    wait_until("load failure", || !live.is_busy());
    let snapshot = live.snapshot();
    assert_eq!(snapshot.state, "failed");
    assert!(snapshot.error.unwrap().contains("model file unreadable"));
    assert_eq!(probe.runs.load(Ordering::SeqCst), 0);
    assert!(read_transcript(&store.root, &broken)?.is_empty());

    probe.fail_load.store(false, Ordering::SeqCst);
    probe.fail_run.store(true, Ordering::SeqCst);
    live.enqueue(&broken);
    live.end(&broken, EndState::Finished);
    wait_until("decode failure", || !live.is_busy());
    assert!(live.snapshot().error.unwrap().contains("decoder failed"));

    probe.fail_run.store(false, Ordering::SeqCst);
    live.enqueue(&next);
    live.end(&next, EndState::Finished);
    wait_until("next meeting", || !live.is_busy());
    assert_eq!(live.snapshot().state, "idle");
    assert_eq!(
        texts(&read_transcript(&store.root, &next)?, Track::Mic),
        ["w3", "w4"]
    );
    assert_eq!(probe.loads.load(Ordering::SeqCst), 2);
    Ok(())
}

#[test]
fn pause_stops_dispatch_and_cancel_never_joins() -> Result<()> {
    let (_dir, store, probe) = fixture()?;
    let meeting = short(&store, 1, true)?;
    let live = spawn(&store, &probe);
    live.pause(true);
    live.enqueue(&meeting);
    live.end(&meeting, EndState::Finished);
    wait_until("paused", || live.snapshot().state == "paused");
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(probe.runs.load(Ordering::SeqCst), 0);
    assert!(live.is_busy());
    probe.set_hold(true);
    live.pause(false);
    wait_until("window in flight", || {
        probe.runs.load(Ordering::SeqCst) == 1
    });
    // Every public call returns while the engine is stuck inside a window.
    let started = Instant::now();
    live.committed(&meeting);
    let _ = live.snapshot();
    let _ = live.is_busy();
    live.cancel();
    assert!(started.elapsed() < Duration::from_millis(50));
    assert!(!live.is_finished());
    probe.set_hold(false);
    wait_until("worker exit", || live.is_finished());
    assert!(!live.is_busy());
    live.enqueue(&meeting);
    assert!(!live.is_busy());
    Ok(())
}

#[test]
fn the_model_is_unloaded_after_the_idle_delay() -> Result<()> {
    let (_dir, store, probe) = fixture()?;
    let tuning = Tuning {
        idle_unload: Duration::from_millis(100),
        recheck: Duration::from_millis(50),
    };
    let live = LiveTranscriber::spawn_tuned(
        store.root.clone(),
        Arc::new(FakeFactory(probe.clone())),
        tuning,
    );
    assert_eq!(probe.loads.load(Ordering::SeqCst), 0);
    for id in [1, 3] {
        let meeting = short(&store, id, true)?;
        live.enqueue(&meeting);
        live.end(&meeting, EndState::Finished);
        wait_until("drain", || !live.is_busy());
        std::thread::sleep(Duration::from_millis(300));
    }
    assert_eq!(probe.loads.load(Ordering::SeqCst), 2);
    Ok(())
}
