//! Test doubles. Words are DC bursts whose level encodes an id, so a fake ASR
//! recovers both the word and its time from the decimated audio alone.
use super::{Asr, AsrFactory, AsrWord, LiveTranscriber};
use crate::{
    capture::{Recording, Track},
    store::Store,
};
use anyhow::{bail, Result};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

pub(crate) const BURST_S: f64 = 0.3;

pub(crate) fn level(id: u32) -> i16 {
    (1000 + 300 * id) as i16
}

/// Bursts `(id, start_s)` of `BURST_S` inside `seconds` of silence at 48 kHz.
pub(crate) fn speech(bursts: &[(u32, f64)], seconds: f64) -> Vec<i16> {
    let mut pcm = vec![0i16; (seconds * 48_000.0) as usize];
    for (id, start) in bursts {
        let a = (start * 48_000.0) as usize;
        let b = ((start + BURST_S) * 48_000.0) as usize;
        pcm[a..b].fill(level(*id));
    }
    pcm
}

/// Runs above 1% of full scale become words; the run's centre gives the id.
/// A step through the low-pass rings for about 1 ms on each side (Gibbs), so
/// runs closer than 5 ms merge and runs shorter than 10 ms are dropped.
pub(crate) fn bursts(pcm: &[f32]) -> Vec<AsrWord> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < pcm.len() {
        if pcm[i] <= 0.01 {
            i += 1;
            continue;
        }
        let start = i;
        while i < pcm.len() && pcm[i] > 0.01 {
            i += 1;
        }
        match runs.last_mut() {
            Some(last) if start - last.1 < 80 => last.1 = i,
            _ => runs.push((start, i)),
        }
    }
    runs.into_iter()
        .filter(|(a, b)| b - a >= 160)
        .map(|(a, b)| {
            let centre = pcm[(a + b) / 2] * 32768.0;
            let id = ((centre - 1000.0) / 300.0).round().max(0.0) as u32;
            AsrWord {
                t0_ms: (a / 16) as u32,
                t1_ms: (b / 16) as u32,
                text: format!("w{id}"),
            }
        })
        .collect()
}

#[derive(Default)]
pub(crate) struct Probe {
    pub loads: AtomicUsize,
    pub runs: AtomicUsize,
    pub fail_load: AtomicBool,
    pub fail_run: AtomicBool,
    pub hold: Mutex<bool>,
    pub release: Condvar,
}

impl Probe {
    pub fn set_hold(&self, hold: bool) {
        *self.hold.lock().unwrap() = hold;
        self.release.notify_all();
    }
}

pub(crate) struct FakeFactory(pub Arc<Probe>);

impl AsrFactory for FakeFactory {
    fn load(&self) -> Result<Box<dyn Asr>> {
        self.0.loads.fetch_add(1, Ordering::SeqCst);
        if self.0.fail_load.load(Ordering::SeqCst) {
            bail!("model file unreadable");
        }
        Ok(Box::new(FakeAsr(self.0.clone())))
    }
}

struct FakeAsr(Arc<Probe>);

impl Asr for FakeAsr {
    fn transcribe(&mut self, pcm16k: &[f32]) -> Result<Vec<AsrWord>> {
        self.0.runs.fetch_add(1, Ordering::SeqCst);
        let mut hold = self.0.hold.lock().unwrap();
        while *hold {
            hold = self.0.release.wait(hold).unwrap();
        }
        if self.0.fail_run.load(Ordering::SeqCst) {
            bail!("decoder failed");
        }
        Ok(bursts(pcm16k))
    }
}

/// Writes both tracks in recorder-sized blocks with checkpoints along the way.
pub(crate) fn record(store: &Store, mic: &[i16], output: &[i16], finish: bool) -> Result<String> {
    let meeting = store.create_meeting("live fixture")?;
    let mut recording = Recording::start(store, &meeting, "fixture-mic", "fixture-output")?;
    for (n, (a, b)) in mic.chunks(4096).zip(output.chunks(4096)).enumerate() {
        recording.write_block(Track::Mic, a, n as u64)?;
        recording.write_block(Track::Output, b, n as u64)?;
        if n % 50 == 0 {
            recording.request_checkpoint()?;
        }
    }
    if finish {
        recording.finish(store, false)?;
    } else {
        recording.checkpoint()?;
    }
    Ok(meeting)
}

pub(crate) fn spawn(store: &Store, probe: &Arc<Probe>) -> LiveTranscriber {
    LiveTranscriber::spawn_tuned(
        store.root.clone(),
        Arc::new(FakeFactory(probe.clone())),
        super::worker::Tuning {
            idle_unload: Duration::from_secs(120),
            recheck: Duration::from_millis(50),
        },
    )
}

pub(crate) fn wait_until(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Texts of one track, in order.
pub(crate) fn texts(segments: &[super::LiveSegment], track: Track) -> Vec<String> {
    segments
        .iter()
        .filter(|s| s.track == track)
        .flat_map(|s| s.text.split(' ').map(str::to_owned).collect::<Vec<_>>())
        .collect()
}
