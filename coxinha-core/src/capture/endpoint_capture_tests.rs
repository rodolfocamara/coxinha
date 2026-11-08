use super::*;

const MIC: &str = "wasapi:default-input";
const OUTPUT: &str = "wasapi:default-output";

fn capture(store: &Store, mic: &str, absent: [bool; 2]) -> (EndpointCapture, Feed) {
    let id = store.create_meeting("windows capture").unwrap();
    let recording = Recording::start(store, &id, mic, OUTPUT).unwrap();
    EndpointCapture::new(recording, absent).unwrap()
}

fn drain(capture: &mut EndpointCapture) -> Result<()> {
    while let Ok(message) = capture.receiver.try_recv() {
        capture.apply(message)?;
    }
    Ok(())
}

fn samples(store: &Store, manifest: &CaptureManifest, track: usize) -> Vec<i16> {
    let path = store
        .root
        .join("raw")
        .join(&manifest.meeting)
        .join(&manifest.tracks[track].file);
    hound::WavReader::open(path)
        .unwrap()
        .into_samples()
        .map(Result::unwrap)
        .collect()
}

fn journal(store: &Store, manifest: &CaptureManifest) -> String {
    std::fs::read_to_string(
        store
            .root
            .join("raw")
            .join(&manifest.meeting)
            .join("timing.jsonl"),
    )
    .unwrap()
}

#[test]
fn an_absent_microphone_is_silence_in_step_with_computer_audio() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (mut capture, feed) = capture(&store, "wasapi:none-input", [true, false]);
    for n in 0..3 {
        assert!(feed.send(Message::Block(Track::Output, vec![5; 960], 10 + n)));
    }
    drain(&mut capture).unwrap();
    let manifest = capture.finish(&store, false).unwrap();
    assert_eq!(manifest.state, "finished");
    assert_eq!(manifest.tracks[0].source, "wasapi:none-input");
    assert_eq!(manifest.tracks[0].frames, 3 * 960);
    assert_eq!(manifest.tracks[1].frames, 3 * 960);
    assert!(samples(&store, &manifest, 0).iter().all(|s| *s == 0));
    assert!(samples(&store, &manifest, 1).iter().all(|s| *s == 5));
    assert!(journal(&store, &manifest).contains("Mic source absent"));
}

#[test]
fn the_final_drain_keeps_a_lost_track_silent_and_journals_the_switch() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (capture, feed) = capture(&store, MIC, [false, false]);
    for message in [
        Message::Block(Track::Mic, vec![1; 960], 1),
        Message::Block(Track::Output, vec![2; 960], 1),
        Message::Lost(Track::Mic, "headset unplugged".into(), 2),
        Message::Block(Track::Output, vec![2; 960], 3),
        Message::Switched(Track::Mic, "Laptop mic".into(), 4),
        Message::Block(Track::Mic, vec![7; 960], 5),
        Message::Block(Track::Output, vec![2; 960], 5),
    ] {
        assert!(feed.send(message));
    }
    let manifest = capture.finish(&store, false).unwrap();
    assert_eq!(manifest.state, "finished");
    let mic = samples(&store, &manifest, 0);
    assert_eq!(mic.len(), 3 * 960);
    assert_eq!(&mic[..960], [1; 960]);
    assert_eq!(&mic[960..1920], [0; 960]);
    assert_eq!(&mic[1920..], [7; 960]);
    assert_eq!(manifest.tracks[1].frames, 3 * 960);
    let journal = journal(&store, &manifest);
    assert!(journal.contains("headset unplugged"), "{journal}");
    assert!(
        journal.contains("recording continues on Laptop mic"),
        "{journal}"
    );
}

#[test]
fn losing_the_last_device_interrupts_and_nothing_to_record_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (mut capture, feed) = capture(&store, "wasapi:none-input", [true, false]);
    assert!(feed.send(Message::Block(Track::Output, vec![3; 960], 1)));
    assert!(feed.send(Message::Lost(Track::Output, "no speakers".into(), 2)));
    let error = drain(&mut capture).unwrap_err().to_string();
    assert!(error.contains("no audio device left"), "{error}");
    assert_eq!(capture.finish(&store, true).unwrap().state, "interrupted");

    let id = store.create_meeting("nothing").unwrap();
    let recording = Recording::start(&store, &id, "wasapi:none-input", OUTPUT).unwrap();
    assert!(EndpointCapture::new(recording, [true, true]).is_err());
}

#[test]
fn a_stalled_present_track_interrupts_but_an_absent_one_never_stalls() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (mut capture, _feed) = capture(&store, "wasapi:none-input", [true, false]);
    capture.last[0] = Instant::now() - Duration::from_secs(3);
    assert!(capture.pump().is_ok());
    capture.last[1] = Instant::now() - Duration::from_secs(3);
    let error = capture.pump().unwrap_err().to_string();
    assert!(error.contains("Output source stalled"), "{error}");
    assert_eq!(capture.finish(&store, true).unwrap().state, "interrupted");
}

#[test]
fn a_failed_explicit_endpoint_never_finishes_as_success() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (mut capture, feed) = capture(&store, MIC, [false, false]);
    assert!(feed.send(Message::Block(Track::Mic, vec![1; 960], 1)));
    assert!(feed.send(Message::Block(Track::Output, vec![1; 960], 1)));
    assert!(feed.send(Message::Failed("Mic endpoint removed".into())));
    let error = drain(&mut capture).unwrap_err().to_string();
    assert!(error.contains("endpoint removed"), "{error}");
    // The pump's caller finishes with interrupted=false on Stop; the flag still wins.
    assert_eq!(capture.finish(&store, false).unwrap().state, "interrupted");
}

#[test]
fn stop_drains_readers_blocked_on_a_full_queue() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (mut capture, feed) = capture(&store, MIC, [false, false]);
    for (track, value) in [(Track::Mic, 11i16), (Track::Output, 22i16)] {
        let feed = feed.clone();
        capture.readers.push(std::thread::spawn(move || {
            for n in 0..100 {
                if !feed.send(Message::Block(track, vec![value; 960], n)) {
                    return;
                }
            }
        }));
    }
    drop(feed);
    std::thread::sleep(Duration::from_millis(30));
    let manifest = capture.finish(&store, false).unwrap();
    assert_eq!(manifest.state, "finished");
    for (track, value) in [(0, 11i16), (1, 22i16)] {
        assert_eq!(manifest.tracks[track].frames, 100 * 960);
        assert!(samples(&store, &manifest, track)
            .iter()
            .all(|s| *s == value));
    }
}

#[test]
fn a_stuck_consumer_is_reported_as_overflow_not_memory_growth() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (mut capture, feed) = capture(&store, MIC, [false, false]);
    let sent = (0..65)
        .take_while(|n| feed.send(Message::Block(Track::Mic, vec![0; 960], *n)))
        .count();
    assert_eq!(sent, 64);
    let error = capture.pump().unwrap_err().to_string();
    assert!(error.contains("overflow"), "{error}");
    assert_eq!(capture.finish(&store, true).unwrap().state, "interrupted");
}

#[test]
fn an_unfinished_windows_capture_recovers_through_the_shared_path() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (mut capture, feed) = capture(&store, "wasapi:none-input", [true, false]);
    let meeting = capture.recording.manifest.meeting.clone();
    assert!(feed.send(Message::Block(Track::Output, vec![9; 960], 1)));
    drain(&mut capture).unwrap();
    capture.recording.checkpoint().unwrap();
    drop(capture);
    let manifest = store.recover_capture(&meeting).unwrap();
    assert_eq!(manifest.state, "interrupted");
    assert_eq!(manifest.tracks[0].frames, 960);
    assert_eq!(manifest.tracks[1].frames, 960);
}
