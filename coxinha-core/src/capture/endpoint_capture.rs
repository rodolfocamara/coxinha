//! Consumer side of the Windows adapter (spec 0133, ADR 0026): reader threads
//! feed blocks and device events; this writes them through `Recording`.
//! Platform-neutral so Linux CI exercises it with fake readers.
#![cfg_attr(not(windows), allow(dead_code))]
use super::{CaptureManifest, Recording, Track};
use crate::store::Store;
use anyhow::{bail, Result};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

pub(crate) enum Message {
    Block(Track, Vec<i16>, u64),
    /// A followed default reopened on another endpoint (or came back).
    Switched(Track, String, u64),
    /// A followed default has no endpoint left; the track turns to silence.
    Lost(Track, String, u64),
    Failed(String),
}

/// What a reader thread holds: the bounded queue and the shared flags.
#[derive(Clone)]
pub(crate) struct Feed {
    sender: SyncSender<Message>,
    overflow: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    failed_source: Arc<AtomicBool>,
    epoch: Instant,
}

impl Feed {
    pub(crate) fn now(&self) -> u64 {
        self.epoch.elapsed().as_nanos().min(u64::MAX as u128) as u64
    }
    pub(crate) fn stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }
    /// False when the reader must exit: queue gone or stalled past the deadline.
    pub(crate) fn send(&self, mut message: Message) -> bool {
        if matches!(message, Message::Failed(_)) && !self.stopping() {
            self.failed_source.store(true, Ordering::Release);
        }
        // Same bound as the Linux reader: wait for a slow writer, never drop audio.
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match self.sender.try_send(message) {
                Ok(()) => return true,
                Err(TrySendError::Full(pending)) => {
                    message = pending;
                    if Instant::now() >= deadline {
                        self.overflow.store(true, Ordering::Release);
                        return false;
                    }
                    std::thread::park_timeout(Duration::from_millis(2));
                }
                Err(TrySendError::Disconnected(_)) => return false,
            }
        }
    }
}

fn index(track: Track) -> usize {
    match track {
        Track::Mic => 0,
        Track::Output => 1,
    }
}
const TRACKS: [Track; 2] = [Track::Mic, Track::Output];

pub struct EndpointCapture {
    pub recording: Recording,
    pub(crate) readers: Vec<JoinHandle<()>>,
    receiver: Receiver<Message>,
    overflow: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    failed_source: Arc<AtomicBool>,
    epoch: Instant,
    pub(crate) last: [Instant; 2],
    absent: [bool; 2],
}

impl EndpointCapture {
    pub(crate) fn new(mut recording: Recording, absent: [bool; 2]) -> Result<(Self, Feed)> {
        anyhow::ensure!(!absent.iter().all(|a| *a), "no audio source to record");
        for (track, _) in TRACKS.iter().zip(absent).filter(|(_, a)| *a) {
            recording.gap(
                &format!("{track:?} source absent: silence written in step with the other track"),
                0,
            )?;
        }
        let (sender, receiver) = mpsc::sync_channel(64);
        let epoch = Instant::now();
        let capture = Self {
            recording,
            readers: Vec::new(),
            receiver,
            overflow: Arc::new(AtomicBool::new(false)),
            stopping: Arc::new(AtomicBool::new(false)),
            failed_source: Arc::new(AtomicBool::new(false)),
            epoch,
            last: [epoch, epoch],
            absent,
        };
        let feed = Feed {
            sender,
            overflow: capture.overflow.clone(),
            stopping: capture.stopping.clone(),
            failed_source: capture.failed_source.clone(),
            epoch,
        };
        Ok((capture, feed))
    }
    pub fn elapsed_ns(&self) -> u64 {
        self.epoch.elapsed().as_nanos().min(u64::MAX as u128) as u64
    }
    pub fn pause(&mut self, paused: bool) -> Result<()> {
        self.recording.pause(paused, self.elapsed_ns())
    }
    /// Writes one block, and the same length of silence on an absent track.
    fn write(&mut self, track: Track, samples: &[i16], arrival: u64) -> Result<f32> {
        let peak = self.recording.write_block(track, samples, arrival)?;
        let other = TRACKS[1 - index(track)];
        if self.absent[index(other)] {
            self.recording
                .write_block(other, &vec![0; samples.len()], arrival)?;
        }
        Ok(peak)
    }
    pub fn pump(&mut self) -> Result<Option<(Track, f32)>> {
        if self.overflow.load(Ordering::Acquire) {
            self.recording
                .gap("bounded capture queue overflow", self.elapsed_ns())?;
            bail!("capture queue overflow; recording interrupted")
        }
        for (i, last) in self.last.iter().enumerate() {
            if !self.absent[i] && last.elapsed() > Duration::from_secs(2) {
                let reason = format!("{:?} source stalled for over two seconds", TRACKS[i]);
                self.recording.gap(&reason, self.elapsed_ns())?;
                bail!(reason)
            }
        }
        match self.receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Message::Block(track, samples, arrival)) => {
                self.last[index(track)] = Instant::now();
                let peak = self.write(track, &samples, arrival)?;
                Ok(Some((track, peak)))
            }
            Ok(Message::Switched(track, endpoint, at)) => {
                self.absent[index(track)] = false;
                self.last[index(track)] = Instant::now();
                self.recording.gap(
                    &format!("{track:?} default device changed; recording continues on {endpoint}"),
                    at,
                )?;
                Ok(None)
            }
            Ok(Message::Lost(track, reason, at)) => {
                self.absent[index(track)] = true;
                self.recording.gap(
                    &format!("{track:?} default device unavailable ({reason}); silence until one returns"),
                    at,
                )?;
                if self.absent.iter().all(|a| *a) {
                    bail!("no audio device left to record")
                }
                Ok(None)
            }
            Ok(Message::Failed(e)) => {
                self.recording.gap(&e, self.elapsed_ns())?;
                bail!(e)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
            Err(e) => bail!("capture channels disconnected: {e}"),
        }
    }
    pub fn stop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        // Readers poll the flag every few milliseconds; keep draining so a
        // reader blocked on a full queue can observe it.
        while self.readers.iter().any(|reader| !reader.is_finished()) {
            if let Ok(Message::Block(track, samples, arrival)) =
                self.receiver.recv_timeout(Duration::from_millis(10))
            {
                if self.write(track, &samples, arrival).is_err() {
                    self.failed_source.store(true, Ordering::Release);
                }
            }
        }
        for reader in self.readers.drain(..) {
            if reader.join().is_err() {
                self.failed_source.store(true, Ordering::Release);
            }
        }
    }
    pub fn finish(mut self, store: &Store, interrupted: bool) -> Result<CaptureManifest> {
        self.stop();
        let mut interrupted = interrupted
            || self.overflow.load(Ordering::Acquire)
            || self.failed_source.load(Ordering::Acquire);
        while let Ok(message) = self.receiver.try_recv() {
            if let Message::Block(track, samples, arrival) = message {
                self.write(track, &samples, arrival)?;
            }
        }
        interrupted |= self.recording.manifest.tracks.iter().any(|t| t.frames == 0);
        if interrupted {
            self.recording.gap("interrupted capture: source failure, queue overflow, missing audio or explicit interruption; inspect source diagnostics", self.elapsed_ns())?;
        }
        self.recording.gap(
            "source streams stopped; trailing partial block under 20 ms is not retained",
            self.elapsed_ns(),
        )?;
        self.recording.finish(store, interrupted)
    }
}

impl Drop for EndpointCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "endpoint_capture_tests.rs"]
mod tests;
