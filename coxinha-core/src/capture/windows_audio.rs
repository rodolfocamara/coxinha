//! WASAPI side of the Windows adapter (spec 0133, ADR 0026): endpoint listing
//! and one polling reader thread per track.
use super::endpoint_capture::{EndpointCapture, Feed, Message};
use super::endpoints::{build_sources, decode, Choice, Endpoint, Framer, Source};
use super::{Recording, Track};
use crate::store::Store;
use anyhow::{bail, ensure, Context, Result};
use std::time::{Duration, Instant};
use wasapi::{
    get_default_device, initialize_mta, AudioCaptureClient, AudioClient, AudioRenderClient,
    BufferFlags, Device, DeviceCollection, Direction, SampleType, StreamMode, WaveFormat,
};

const POLL: Duration = Duration::from_millis(10);
/// 200 ms of shared-mode buffer: ample for a 10 ms poll.
const BUFFER_HNS: i64 = 2_000_000;
/// Reopen attempts that deliver nothing before a track gives up.
const MAX_EMPTY_OPENS: u32 = 3;

fn direction(track: Track) -> Direction {
    match track {
        Track::Mic => Direction::Capture,
        Track::Output => Direction::Render,
    }
}

fn endpoints(direction: &Direction) -> Result<Vec<Endpoint>> {
    let collection = DeviceCollection::new(direction)?;
    let mut list = Vec::new();
    for device in &collection {
        let device = device?;
        let id = device.get_id()?;
        let name = device.get_friendlyname().unwrap_or_else(|_| id.clone());
        list.push(Endpoint { id, name });
    }
    Ok(list)
}

fn default_id(direction: &Direction) -> Option<String> {
    get_default_device(direction).and_then(|d| d.get_id()).ok()
}

/// Never opens a stream: enumeration only.
pub fn list_sources() -> Result<Vec<Source>> {
    // S_FALSE or RPC_E_CHANGED_MODE still leave COM usable on this thread.
    let _ = initialize_mta();
    build_sources(
        &endpoints(&Direction::Capture)?,
        &endpoints(&Direction::Render)?,
        default_id(&Direction::Capture).as_deref(),
        default_id(&Direction::Render).as_deref(),
    )
}

fn resolve(track: Track, choice: &Choice) -> Result<Device> {
    let direction = direction(track);
    match choice {
        Choice::Default => Ok(get_default_device(&direction)?),
        Choice::Endpoint(id) => {
            for device in &DeviceCollection::new(&direction)? {
                let device = device?;
                if device.get_id()? == *id {
                    return Ok(device);
                }
            }
            bail!("{track:?} endpoint is no longer active")
        }
        Choice::Absent => bail!("absent source has no endpoint"),
    }
}

/// An open endpoint: capture (or loopback) plus, for computer audio, a silent
/// render stream so loopback keeps delivering while nothing plays.
struct Stream {
    id: String,
    name: String,
    client: AudioClient,
    capture: AudioCaptureClient,
    keepalive: Option<(AudioClient, AudioRenderClient)>,
}

enum End {
    Stopped,
    DefaultChanged,
}

impl Stream {
    fn open(track: Track, device: Device) -> Result<Self> {
        let id = device.get_id()?;
        let name = device.get_friendlyname().unwrap_or_else(|_| id.clone());
        // The audio engine converts rate and channels; the files stay 48 kHz mono.
        let format = WaveFormat::new(16, 16, &SampleType::Int, 48_000, 1, None);
        let mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: BUFFER_HNS,
        };
        let mut client = device.get_iaudioclient()?;
        // On a render endpoint, Capture direction selects loopback.
        client.initialize_client(&format, &Direction::Capture, &mode)?;
        let capture = client.get_audiocaptureclient()?;
        let keepalive = if track == Track::Output {
            let mut render = device.get_iaudioclient()?;
            render.initialize_client(&format, &Direction::Render, &mode)?;
            let writer = render.get_audiorenderclient()?;
            Some((render, writer))
        } else {
            None
        };
        Ok(Self {
            id,
            name,
            client,
            capture,
            keepalive,
        })
    }

    fn feed_silence(&self) -> Result<()> {
        if let Some((client, writer)) = &self.keepalive {
            let frames = client.get_available_space_in_frames()? as usize;
            let flags = BufferFlags {
                data_discontinuity: false,
                silent: true,
                timestamp_error: false,
            };
            writer.write_to_device(frames, &vec![0u8; frames * 2], Some(flags))?;
        }
        Ok(())
    }

    /// Reads until stopped, failed, or (when following) the default moves.
    fn run(
        &self,
        track: Track,
        feed: &Feed,
        framer: &mut Framer,
        follow: bool,
        delivered: &mut u64,
    ) -> Result<End> {
        self.feed_silence()?;
        if let Some((client, _)) = &self.keepalive {
            client.start_stream()?;
        }
        self.client.start_stream()?;
        let mut bytes = vec![0u8; 96_000];
        let mut checked = Instant::now();
        let result = (|| loop {
            if feed.stopping() {
                return Ok(End::Stopped);
            }
            self.feed_silence()?;
            while let Some(frames) = self.capture.get_next_packet_size()?.filter(|n| *n > 0) {
                let need = frames as usize * 2;
                if bytes.len() < need {
                    bytes.resize(need, 0);
                }
                let (read, flags) = self.capture.read_from_device(&mut bytes)?;
                let read = read as usize;
                let samples = if flags.silent {
                    vec![0; read]
                } else {
                    decode(&bytes[..read * 2])
                };
                for block in framer.push(&samples) {
                    *delivered += 1;
                    if !feed.send(Message::Block(track, block, feed.now())) {
                        return Ok(End::Stopped);
                    }
                }
            }
            if follow && checked.elapsed() >= Duration::from_secs(1) {
                checked = Instant::now();
                if default_id(&direction(track)).as_deref() != Some(self.id.as_str()) {
                    return Ok(End::DefaultChanged);
                }
            }
            std::thread::sleep(POLL);
        })();
        let _ = self.client.stop_stream();
        if let Some((client, _)) = &self.keepalive {
            let _ = client.stop_stream();
        }
        result
    }
}

fn wait(feed: &Feed, duration: Duration) {
    let until = Instant::now() + duration;
    while !feed.stopping() && Instant::now() < until {
        std::thread::sleep(POLL);
    }
}

/// One track for the life of the capture. A followed default reopens on change
/// or loss; an explicit endpoint fails instead (no fallback, as on Linux).
fn run_track(track: Track, choice: Choice, feed: Feed) {
    let _ = initialize_mta();
    let follow = choice == Choice::Default;
    let mut framer = Framer::default();
    let mut opened = false;
    let mut lost = false;
    let mut empty_opens = 0;
    while !feed.stopping() {
        let stream = resolve(track, &choice).and_then(|device| Stream::open(track, device));
        let stream = match stream {
            Ok(stream) => stream,
            Err(e) if follow && opened => {
                if !lost {
                    lost = true;
                    if !feed.send(Message::Lost(track, format!("{e:#}"), feed.now())) {
                        return;
                    }
                }
                wait(&feed, Duration::from_millis(500));
                continue;
            }
            Err(e) => {
                feed.send(Message::Failed(format!(
                    "{track:?} source failed to open: {e:#}"
                )));
                return;
            }
        };
        if opened && !feed.send(Message::Switched(track, stream.name.clone(), feed.now())) {
            return;
        }
        opened = true;
        lost = false;
        let mut delivered = 0;
        let end = stream.run(track, &feed, &mut framer, follow, &mut delivered);
        empty_opens = if delivered > 0 { 0 } else { empty_opens + 1 };
        match end {
            Ok(End::Stopped) => return,
            Ok(End::DefaultChanged) if empty_opens < MAX_EMPTY_OPENS => {}
            Err(_) if follow && empty_opens < MAX_EMPTY_OPENS => {}
            Ok(End::DefaultChanged) => {
                feed.send(Message::Failed(format!(
                    "{track:?} source delivered no audio"
                )));
                return;
            }
            Err(e) => {
                feed.send(Message::Failed(format!("{track:?} source failed: {e:#}")));
                return;
            }
        }
    }
}

impl EndpointCapture {
    /// Explicit opt-in API: never called during startup or device enumeration.
    pub fn start(store: &Store, meeting: &str, mic: &str, output: &str) -> Result<Self> {
        let sources = list_sources()?;
        ensure!(
            sources.iter().any(|s| s.name == mic && !s.monitor),
            "selected microphone is not an enumerated input"
        );
        ensure!(
            sources.iter().any(|s| s.name == output && s.monitor),
            "selected output is not an enumerated monitor"
        );
        let choices = [Choice::parse(mic, false)?, Choice::parse(output, true)?];
        let absent = choices.each_ref().map(|c| *c == Choice::Absent);
        ensure!(!absent.iter().all(|a| *a), "no audio source to record");
        let recording = Recording::start(store, meeting, mic, output)?;
        let (mut capture, feed) = EndpointCapture::new(recording, absent)?;
        for (track, choice) in [Track::Mic, Track::Output].into_iter().zip(choices) {
            if choice == Choice::Absent {
                continue;
            }
            let feed = feed.clone();
            let reader = std::thread::Builder::new()
                .name(format!("capture-{track:?}").to_lowercase())
                .spawn(move || run_track(track, choice, feed))
                .context("capture reader failed to start");
            match reader {
                Ok(reader) => capture.readers.push(reader),
                Err(e) => {
                    capture
                        .recording
                        .gap("source thread failed to start", capture.elapsed_ns())?;
                    return Err(e);
                }
            }
        }
        Ok(capture)
    }
}
