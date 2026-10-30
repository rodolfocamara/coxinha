use super::{list_sources, Recording, Track};
use crate::store::Store;
use anyhow::{bail, ensure, Context, Result};
use std::{
    io::Read,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, TrySendError},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

enum Message {
    Block(Track, Vec<i16>, u64),
    Failed(String),
}
fn read_blocks(
    reader: &mut impl Read,
    track: Track,
    sender: mpsc::SyncSender<Message>,
    overflow: Arc<AtomicBool>,
    epoch: Instant,
    stopping: Arc<AtomicBool>,
    failed_source: Arc<AtomicBool>,
) {
    let mut bytes = [0u8; 1920];
    loop {
        let mut message = match reader.read_exact(&mut bytes) {
            Ok(()) => Message::Block(
                track,
                bytes
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
                    .collect(),
                epoch.elapsed().as_nanos().min(u64::MAX as u128) as u64,
            ),
            Err(e) => {
                if !stopping.load(Ordering::Acquire) {
                    failed_source.store(true, Ordering::Release);
                }
                Message::Failed(format!("{track:?} source ended: {e}"))
            }
        };
        let failed = matches!(message, Message::Failed(_));
        // Keep one pending block per reader while downstream catches up. The
        // deadline bounds a permanently stalled consumer without dropping audio.
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match sender.try_send(message) {
                Ok(()) => break,
                Err(TrySendError::Full(pending)) => {
                    message = pending;
                    if Instant::now() >= deadline {
                        overflow.store(true, Ordering::Release);
                        return;
                    }
                    std::thread::park_timeout(Duration::from_millis(2));
                }
                Err(TrySendError::Disconnected(_)) => return,
            }
        }
        if failed {
            break;
        }
    }
}
pub struct PulseCapture {
    pub recording: Recording,
    children: Vec<Child>,
    readers: Vec<JoinHandle<()>>,
    receiver: Receiver<Message>,
    overflow: Arc<AtomicBool>,
    epoch: Instant,
    last: [Instant; 2],
    stopping: Arc<AtomicBool>,
    failed_source: Arc<AtomicBool>,
}
impl PulseCapture {
    /// Explicit opt-in API: never called during startup or device enumeration.
    pub fn start(store: &Store, meeting: &str, mic: &str, monitor: &str) -> Result<Self> {
        let sources = list_sources()?;
        ensure!(
            sources.iter().any(|s| s.name == mic && !s.monitor),
            "selected microphone is not an enumerated input"
        );
        ensure!(
            sources.iter().any(|s| s.name == monitor && s.monitor),
            "selected output is not an enumerated monitor"
        );
        ensure!(mic != monitor, "microphone and monitor must differ");
        let recording = Recording::start(store, meeting, mic, monitor)?;
        let (sender, receiver) = mpsc::sync_channel(64);
        let overflow = Arc::new(AtomicBool::new(false));
        let epoch = Instant::now();
        let mut capture = Self {
            recording,
            children: Vec::new(),
            readers: Vec::new(),
            receiver,
            overflow,
            epoch,
            last: [epoch, epoch],
            stopping: Arc::new(AtomicBool::new(false)),
            failed_source: Arc::new(AtomicBool::new(false)),
        };
        for (track, source) in [(Track::Mic, mic), (Track::Output, monitor)] {
            let child = Command::new("parec")
                .args([
                    "--raw",
                    "--format=s16le",
                    "--rate=48000",
                    "--channels=1",
                    "--latency-msec=20",
                    "--device",
                    source,
                ])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn();
            let mut child = match child {
                Ok(child) => child,
                Err(e) => {
                    capture
                        .recording
                        .gap("source process failed to start", capture.elapsed_ns())?;
                    return Err(e.into());
                }
            };
            let mut stdout = child.stdout.take().context("audio pipe missing")?;
            capture.children.push(child);
            let sender = sender.clone();
            let overflow = capture.overflow.clone();
            let stopping = capture.stopping.clone();
            let failed_source = capture.failed_source.clone();
            capture.readers.push(std::thread::spawn(move || {
                read_blocks(
                    &mut stdout,
                    track,
                    sender,
                    overflow,
                    epoch,
                    stopping,
                    failed_source,
                );
            }));
        }
        Ok(capture)
    }
    pub fn elapsed_ns(&self) -> u64 {
        self.epoch.elapsed().as_nanos().min(u64::MAX as u128) as u64
    }
    pub fn pause(&mut self, paused: bool) -> Result<()> {
        self.recording.pause(paused, self.elapsed_ns())
    }
    pub fn pump(&mut self) -> Result<Option<(Track, f32)>> {
        if self.overflow.load(Ordering::Acquire) {
            self.recording
                .gap("bounded capture queue overflow", self.elapsed_ns())?;
            bail!("capture queue overflow; recording interrupted")
        }
        for (i, last) in self.last.iter().enumerate() {
            if last.elapsed() > Duration::from_secs(2) {
                let reason = format!(
                    "{} source stalled for over two seconds; no default fallback",
                    if i == 0 { "Mic" } else { "Output" }
                );
                self.recording.gap(&reason, self.elapsed_ns())?;
                bail!(reason)
            }
        }
        match self.receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Message::Block(track, samples, arrival)) => {
                let i = match track {
                    Track::Mic => 0,
                    Track::Output => 1,
                };
                self.last[i] = Instant::now();
                let peak = self.recording.write_block(track, &samples, arrival)?;
                Ok(Some((track, peak)))
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
        for child in &mut self.children {
            let _ = child.kill();
            let _ = child.wait();
        }
        // Drain before joining: readers may be waiting to enqueue their last
        // complete block after the source process has been killed.
        while self.readers.iter().any(|reader| !reader.is_finished()) {
            match self.receiver.recv_timeout(Duration::from_millis(10)) {
                Ok(Message::Block(track, samples, arrival)) => {
                    if self
                        .recording
                        .write_block(track, &samples, arrival)
                        .is_err()
                    {
                        self.failed_source.store(true, Ordering::Release);
                    }
                }
                Ok(Message::Failed(_)) | Err(_) => {}
            }
        }
        for reader in self.readers.drain(..) {
            if reader.join().is_err() {
                self.failed_source.store(true, Ordering::Release);
            }
        }
    }
    pub fn finish(mut self, store: &Store, interrupted: bool) -> Result<super::CaptureManifest> {
        // Observe unexpected child exit before sending our own stop signal.
        let exited = self
            .children
            .iter_mut()
            .any(|child| !matches!(child.try_wait(), Ok(None)));
        self.stop();
        let mut interrupted = interrupted
            || exited
            || self.overflow.load(Ordering::Acquire)
            || self.failed_source.load(Ordering::Acquire);
        while let Ok(message) = self.receiver.try_recv() {
            match message {
                Message::Block(track, samples, arrival) => {
                    self.recording.write_block(track, &samples, arrival)?;
                }
                // EOF caused by our own stop is expected; reader failure before
                // stop is detected by pump. Queue overflow is never success.
                Message::Failed(_) => {}
            }
        }
        interrupted |= self.recording.manifest.tracks.iter().any(|t| t.frames == 0);
        if interrupted {
            self.recording.gap("interrupted capture: source failure, queue overflow, missing audio or explicit interruption; inspect source diagnostics", self.elapsed_ns())?;
        }
        self.recording.gap(
            "source processes stopped; trailing partial block under 20 ms is not retained",
            self.elapsed_ns(),
        )?;
        self.recording.finish(store, interrupted)
    }
}
impl Drop for PulseCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn synthetic_capture(store: &Store) -> PulseCapture {
        let id = store.create_meeting("synthetic pulse lifecycle").unwrap();
        let mut recording = Recording::start(store, &id, "fixture-mic", "fixture-monitor").unwrap();
        recording.write_block(Track::Mic, &[1; 960], 1).unwrap();
        recording.write_block(Track::Output, &[2; 960], 1).unwrap();
        let (_tx, receiver) = mpsc::sync_channel(4);
        let epoch = Instant::now();
        PulseCapture {
            recording,
            children: vec![],
            readers: vec![],
            receiver,
            overflow: Arc::new(AtomicBool::new(false)),
            epoch,
            last: [epoch, epoch],
            stopping: Arc::new(AtomicBool::new(false)),
            failed_source: Arc::new(AtomicBool::new(false)),
        }
    }
    #[test]
    fn overflow_or_pre_stop_reader_failure_never_finishes_as_success() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let capture = synthetic_capture(&store);
        capture.overflow.store(true, Ordering::Release);
        assert_eq!(capture.finish(&store, false).unwrap().state, "interrupted");
        let capture = synthetic_capture(&store);
        capture.failed_source.store(true, Ordering::Release);
        assert_eq!(capture.finish(&store, false).unwrap().state, "interrupted");
        assert_eq!(
            synthetic_capture(&store)
                .finish(&store, false)
                .unwrap()
                .state,
            "finished"
        );
    }
    #[test]
    fn stalled_output_is_diagnosed_while_mic_remains_healthy() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let mut capture = synthetic_capture(&store);
        capture.last[1] = Instant::now() - Duration::from_secs(3);
        let error = capture.pump().unwrap_err().to_string();
        assert!(error.contains("Output source stalled"), "{error}");
        assert_eq!(capture.finish(&store, true).unwrap().state, "interrupted");
    }
    #[test]
    fn transient_full_queue_preserves_ordered_original_blocks() {
        let (tx, rx) = mpsc::sync_channel(1);
        let overflow = Arc::new(AtomicBool::new(false));
        let flag = overflow.clone();
        let input: Vec<u8> = (0..8i16)
            .flat_map(|n| n.to_le_bytes().repeat(960))
            .collect();
        let reader = std::thread::spawn(move || {
            read_blocks(
                &mut std::io::Cursor::new(input),
                Track::Mic,
                tx,
                flag,
                Instant::now(),
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicBool::new(false)),
            )
        });
        // Hold the consumer until capacity is reached, like a delayed disk writer.
        std::thread::sleep(Duration::from_millis(30));
        for expected in 0..8i16 {
            match rx.recv_timeout(Duration::from_secs(1)).unwrap() {
                Message::Block(_, samples, _) => assert_eq!(samples, vec![expected; 960]),
                Message::Failed(e) => panic!("{e}"),
            }
        }
        reader.join().unwrap();
        assert!(!overflow.load(Ordering::Acquire));
    }
    #[test]
    fn stop_drains_full_queue_from_both_sources_before_joining() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let mut capture = synthetic_capture(&store);
        let (tx, rx) = mpsc::sync_channel(1);
        capture.receiver = rx;
        for (track, value) in [(Track::Mic, 11i16), (Track::Output, 22i16)] {
            let tx = tx.clone();
            let overflow = capture.overflow.clone();
            let stopping = capture.stopping.clone();
            let failed = capture.failed_source.clone();
            let epoch = capture.epoch;
            capture.readers.push(std::thread::spawn(move || {
                let bytes: Vec<u8> = value.to_le_bytes().repeat(960 * 8);
                read_blocks(
                    &mut std::io::Cursor::new(bytes),
                    track,
                    tx,
                    overflow,
                    epoch,
                    stopping,
                    failed,
                );
            }));
        }
        drop(tx);
        let manifest = capture.finish(&store, false).unwrap();
        assert_eq!(manifest.tracks[0].frames, 9 * 960);
        assert_eq!(manifest.tracks[1].frames, 9 * 960);
        for (track, value) in manifest.tracks.iter().zip([11i16, 22i16]) {
            let audio = hound::WavReader::open(
                dir.path()
                    .join("raw")
                    .join(&manifest.meeting)
                    .join(&track.file),
            )
            .unwrap();
            let samples: Vec<i16> = audio.into_samples().map(Result::unwrap).collect();
            assert_eq!(&samples[960..], vec![value; 8 * 960]);
        }
    }
    #[test]
    fn bounded_reader_reports_overflow_instead_of_growing_memory() {
        let (tx, rx) = mpsc::sync_channel(1);
        let overflow = Arc::new(AtomicBool::new(false));
        read_blocks(
            &mut std::io::Cursor::new(vec![0u8; 1920 * 3]),
            Track::Mic,
            tx,
            overflow.clone(),
            Instant::now(),
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        );
        assert!(overflow.load(Ordering::Acquire));
        assert!(matches!(rx.try_recv(), Ok(Message::Block(..))));
        assert!(rx.try_recv().is_err());
    }
    #[test]
    fn failed_source_is_reported_without_default_fallback() {
        let (tx, rx) = mpsc::sync_channel(1);
        let overflow = Arc::new(AtomicBool::new(false));
        read_blocks(
            &mut std::io::Cursor::new(Vec::<u8>::new()),
            Track::Output,
            tx,
            overflow,
            Instant::now(),
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        );
        assert!(matches!(rx.try_recv(), Ok(Message::Failed(_))));
    }
}
