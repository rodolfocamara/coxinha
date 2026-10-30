use super::*;
use std::sync::mpsc;

fn input() -> PreparedProcessing {
    PreparedProcessing {
        meeting: "synthetic".into(),
        job: "attempt".into(),
        tracks: vec![],
        config: ProcessingConfig {
            engine_version: "fake".into(),
            models: Default::default(),
            parameters: serde_json::json!({}),
        },
    }
}
fn output() -> ProcessingResult {
    ProcessingResult {
        segments: vec![],
        turns: vec![],
        warnings: vec![],
    }
}
struct UnexpectedEngine;
impl ProcessingEngine for UnexpectedEngine {
    fn run(&mut self, _: PreparedProcessing) -> Result<ProcessingResult> {
        panic!("cancelled execution must not call the engine")
    }
}
#[test]
fn pre_cancel_is_typed_and_does_not_touch_a_missing_source() {
    let control = ProcessingControl::default();
    let cloned = control.clone();
    cloned.cancel();
    control.cancel();
    assert!(cloned.is_cancelled());
    assert!(!ProcessingControl::default().is_cancelled());
    let mut prepared = input();
    prepared.tracks.push(TrackInput {
        track: "mic".into(),
        path: "/missing-fixture.wav".into(),
        audio_sha256: "bad".into(),
        frames: 1,
        sample_rate: 48000,
    });
    let error = run_processing_controlled(prepared, UnexpectedEngine, &control).unwrap_err();
    assert!(error.is::<ProcessingCancelled>());
}
struct BlockingEngine {
    entered: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
    fail: bool,
}
impl ProcessingEngine for BlockingEngine {
    fn run(&mut self, _: PreparedProcessing) -> Result<ProcessingResult> {
        self.entered.send(())?;
        self.release.recv()?;
        if self.fail {
            anyhow::bail!("native engine aborted")
        }
        Ok(output())
    }
}
#[test]
fn cancel_does_not_mean_finished_and_late_success_or_error_is_not_publishable() {
    for fail in [false, true] {
        let control = ProcessingControl::default();
        let owned = control.clone();
        let (entered, seen) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            run_processing_controlled(
                input(),
                BlockingEngine {
                    entered,
                    release: wait,
                    fail,
                },
                &owned,
            )
        });
        seen.recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        control.cancel();
        assert!(!worker.is_finished());
        release.send(()).unwrap();
        let error = worker.join().unwrap().unwrap_err();
        assert!(error.is::<ProcessingCancelled>());
    }
}
struct IgnoresControl(ProcessingControl);
impl ProcessingEngine for IgnoresControl {
    fn run(&mut self, _: PreparedProcessing) -> Result<ProcessingResult> {
        Ok(output())
    }
    fn run_controlled(
        &mut self,
        _: PreparedProcessing,
        _: &ProcessingControl,
    ) -> Result<ProcessingResult> {
        self.0.cancel();
        Ok(output())
    }
}
#[test]
fn outer_boundary_rejects_even_a_controlled_engine_that_returns_after_cancel() {
    let control = ProcessingControl::default();
    let error =
        run_processing_controlled(input(), IgnoresControl(control.clone()), &control).unwrap_err();
    assert!(error.is::<ProcessingCancelled>());
}
struct ChangesSource(std::path::PathBuf);
impl ProcessingEngine for ChangesSource {
    fn run(&mut self, _: PreparedProcessing) -> Result<ProcessingResult> {
        std::fs::write(&self.0, b"changed")?;
        Ok(output())
    }
}
#[test]
fn uncancelled_execution_still_rejects_changed_source_and_digest_matches_existing() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.wav");
    std::fs::write(&path, vec![7u8; 140000])?;
    let control = ProcessingControl::default();
    let digest = control.digest(&path)?;
    assert_eq!(digest, crate::artifacts::digest(&path)?);
    let mut prepared = input();
    prepared.tracks.push(TrackInput {
        track: "imported".into(),
        path: path.clone(),
        audio_sha256: digest.0,
        frames: 1,
        sample_rate: 48000,
    });
    let error = run_processing_controlled(prepared, ChangesSource(path), &control).unwrap_err();
    assert!(error.to_string().contains("raw source changed"));
    assert!(!error.is::<ProcessingCancelled>());
    Ok(())
}
struct Success;
impl ProcessingEngine for Success {
    fn run(&mut self, _: PreparedProcessing) -> Result<ProcessingResult> {
        Ok(output())
    }
}
#[test]
fn legacy_thread_entry_point_remains_joinable() {
    assert!(execute_processing(input(), Success).join().unwrap().is_ok());
}
