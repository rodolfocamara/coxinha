use anyhow::Result;
use coxinha_core::store::Store;
use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
};

#[test]
fn killed_synthetic_capture_recovers_uncheckpointed_tail() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let mut child = Command::new(env!("CARGO_BIN_EXE_coxinha-meetings"))
        .args(["smoke-hold", directory.path().to_str().unwrap()])
        .stdout(Stdio::piped())
        .spawn()?;
    let mut meeting = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut meeting)?;
    child.kill()?;
    child.wait()?;
    let store = Store::open(directory.path())?;
    let manifest = store.recover_capture(meeting.trim())?;
    assert_eq!(manifest.state, "interrupted");
    for track in &manifest.tracks {
        assert_eq!(track.frames, 39360);
        let wav = hound::WavReader::open(
            directory
                .path()
                .join("raw")
                .join(meeting.trim())
                .join(&track.file),
        )?;
        assert_eq!(wav.duration(), 39360);
    }
    store.verify_raw(meeting.trim())?;
    Ok(())
}
