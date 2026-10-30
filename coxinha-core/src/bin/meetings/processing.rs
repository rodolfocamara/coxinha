use anyhow::{ensure, Context, Result};
use coxinha_core::{
    capture::{Recording, Track},
    processing::{execute_processing, ProcessingConfig},
    speech::LocalSpeechEngine,
    store::Store,
};
use std::path::Path;
pub fn process(root: &str, meeting: &str, config: &str) -> Result<()> {
    let mut store = Store::open(root)?;
    let config: ProcessingConfig = serde_json::from_reader(std::fs::File::open(config)?)?;
    let input = store.prepare_processing(meeting, &config)?;
    if store.job_state(&input.job)? == "failed" {
        store.retry_job(&input.job)?;
    }
    if store.job_state(&input.job)? == "succeeded" {
        store.resume_processing_publication(&input)?;
    } else if store.claim(&input.job)? {
        let result: Result<()> = (|| {
            if !store.resume_processing_publication(&input)? {
                let result = execute_processing(input.clone(), LocalSpeechEngine)
                    .join()
                    .map_err(|_| anyhow::anyhow!("inference worker panicked"))??;
                store.commit_processing(&input, result)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            if store.job_state(&input.job)? == "running" {
                store.finish_job(&input.job, Some(&error.to_string()))?;
            }
            return Err(error);
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&store.processing_report(meeting)?)?
    );
    Ok(())
}
pub fn import(root: &str, title: &str, mic: &str, output: &str) -> Result<()> {
    let read = |path: &str| -> Result<Vec<i16>> {
        let mut r = hound::WavReader::open(Path::new(path))?;
        let s = r.spec();
        ensure!(
            s.channels == 1
                && s.sample_rate == 48000
                && s.bits_per_sample == 16
                && s.sample_format == hound::SampleFormat::Int,
            "import requires PCM16 mono 48 kHz WAV"
        );
        Ok(r.samples::<i16>()
            .collect::<std::result::Result<Vec<_>, _>>()?)
    };
    let mic = read(mic)?;
    let output = read(output)?;
    ensure!(!mic.is_empty() && !output.is_empty(), "empty fixture");
    let store = Store::open(root)?;
    let meeting = store.create_meeting(title)?;
    let mut recording = Recording::start(
        &store,
        &meeting,
        "fixture-import-mic",
        "fixture-import-output",
    )?;
    for (track, samples) in [(Track::Mic, mic), (Track::Output, output)] {
        let mut frame = 0u64;
        for block in samples.chunks(4096) {
            frame += block.len() as u64;
            recording
                .write_block(track, block, frame * 1_000_000_000 / 48000)
                .context("importing fixture frames")?;
        }
    }
    recording.finish(&store, false)?;
    println!("{meeting}");
    Ok(())
}
