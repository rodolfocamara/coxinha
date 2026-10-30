use super::*;
#[test]
fn interrupted_capture_recovers_headers_and_preserves_separate_tracks() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let m = s.create_meeting("fixture")?;
    assert!(Recording::start(&s, &m, "same", "same").is_err());
    let mut r = Recording::start(&s, &m, "synthetic-mic", "synthetic-monitor")?;
    r.write_block(Track::Mic, &[1; 960], 20_000_000)?;
    r.write_block(Track::Output, &[2; 960], 21_000_000)?;
    r.checkpoint()?;
    r.pause(true, 22_000_000)?;
    r.write_block(Track::Mic, &[3; 960], 40_000_000)?;
    r.pause(false, 45_000_000)?;
    r.write_block(Track::Mic, &[4; 960], 60_000_000)?;
    assert!(r.write_block(Track::Mic, &[0; 960], 59_000_000).is_err());
    assert!(r
        .write_block(Track::Output, &[0; MAX_SAMPLES + 1], 60_000_000)
        .is_err());
    assert!(s.backup(&d.path().join("active-backup")).is_err());
    drop(r);
    let manifest = s.recover_capture(&m)?;
    assert_eq!(manifest.tracks[0].frames, 1920);
    assert_eq!(manifest.tracks[1].frames, 960);
    let mic = hound::WavReader::open(d.path().join("raw").join(&m).join("mic.wav"))?;
    assert_eq!(mic.duration(), 1920);
    assert_eq!(manifest.state, "interrupted");
    assert!(manifest.alignment.contains("unmeasured"));
    Ok(())
}
#[test]
fn finished_capture_is_immutable() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let m = s.create_meeting("fixture")?;
    let mut r = Recording::start(&s, &m, "synthetic-mic", "synthetic-output")?;
    r.write_block(Track::Mic, &[10; 960], 20_000_000)?;
    r.write_block(Track::Output, &[-10; 960], 20_000_000)?;
    let manifest = r.finish(&s, false)?;
    assert!(manifest.tracks.iter().all(|t| t.sha256.is_some()));
    assert_eq!(s.recover_capture(&m)?.state, "finished");
    assert!(Recording::start(&s, &m, "m", "o").is_err());
    assert!(r.write_block(Track::Mic, &[0; 960], 40_000_000).is_err());
    Ok(())
}

#[test]
fn blocked_checkpoint_does_not_block_audio_and_finish_publishes_latest_frames() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let m = s.create_meeting("delayed durability")?;
    let mut r = Recording::start(&s, &m, "mic", "output")?;
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    // A barrier models a durability operation waiting on storage. The audio
    // writes must complete before that operation is allowed to return.
    r.checkpoint_job = Some(std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        release_rx.recv().unwrap();
        Ok(())
    }));
    started_rx.recv()?;
    for frame in 0..100u64 {
        r.request_checkpoint()?;
        r.write_block(Track::Mic, &[frame as i16; 960], frame)?;
        r.write_block(Track::Output, &[-(frame as i16); 960], frame)?;
    }
    assert!(!r.checkpoint_job.as_ref().unwrap().is_finished());
    release_tx.send(())?;
    let manifest = r.finish(&s, false)?;
    assert_eq!(manifest.tracks[0].frames, 96_000);
    assert_eq!(manifest.tracks[1].frames, 96_000);
    assert_eq!(s.recover_capture(&m)?.state, "finished");
    for (name, sign) in [("mic.wav", 1), ("output.wav", -1)] {
        let audio = hound::WavReader::open(d.path().join("raw").join(&m).join(name))?;
        let samples: Vec<i16> = audio
            .into_samples()
            .collect::<std::result::Result<_, _>>()?;
        let expected: Vec<i16> = (0..100).flat_map(|n| vec![n * sign; 960]).collect();
        assert_eq!(samples, expected);
    }
    Ok(())
}

#[test]
fn concurrent_header_checkpoints_preserve_writer_offsets() -> Result<()> {
    let d = tempfile::tempdir()?;
    let s = Store::open(d.path())?;
    let m = s.create_meeting("independent file offsets")?;
    let mut r = Recording::start(&s, &m, "mic", "output")?;
    for frame in 0..200u64 {
        r.write_block(Track::Mic, &[frame as i16; 960], frame)?;
        r.write_block(Track::Output, &[-(frame as i16); 960], frame)?;
        r.request_checkpoint()?;
    }
    r.finish(&s, false)?;
    for (name, sign) in [("mic.wav", 1), ("output.wav", -1)] {
        let audio = hound::WavReader::open(d.path().join("raw").join(&m).join(name))?;
        let samples: Vec<i16> = audio
            .into_samples()
            .collect::<std::result::Result<_, _>>()?;
        let expected: Vec<i16> = (0..200).flat_map(|n| vec![n * sign; 960]).collect();
        assert_eq!(samples, expected);
    }
    Ok(())
}
