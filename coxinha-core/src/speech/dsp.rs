use anyhow::{ensure, Result};
use std::{collections::VecDeque, path::Path};
// Symmetric 97-tap windowed sinc, cutoff 7 kHz. Centered sampling compensates
// FIR group delay; edge zero padding never shifts the original track timeline.
#[cfg(test)]
pub(super) fn normalize(path: &Path, max_seconds: u64) -> Result<Vec<f32>> {
    normalize_controlled(
        path,
        max_seconds,
        &crate::processing::ProcessingControl::default(),
    )
}
pub(super) fn normalize_controlled(
    path: &Path,
    max_seconds: u64,
    control: &crate::processing::ProcessingControl,
) -> Result<Vec<f32>> {
    control.check()?;
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    ensure!(
        spec.channels == 1
            && spec.sample_rate == 48000
            && spec.bits_per_sample == 16
            && spec.sample_format == hound::SampleFormat::Int,
        "Raw track must be PCM16 mono 48kHz"
    );
    let count = reader.duration() as usize;
    ensure!(
        count > 0 && count as u64 <= max_seconds * 48000,
        "Track is empty or exceeds configured bounded-memory duration"
    );
    let taps = kernel();
    let mut source = reader.samples::<i16>();
    let mut queue = VecDeque::from(vec![0.0f32; 48]);
    for _ in 0..49 {
        queue.push_back(match source.next() {
            Some(v) => v? as f32 / 32768.0,
            None => 0.0,
        });
    }
    control.check()?;
    let mut output = Vec::with_capacity(count.div_ceil(3));
    for center in (0..count).step_by(3) {
        if center % 3072 == 0 {
            control.check()?;
        }
        output.push(queue.iter().zip(&taps).map(|(x, h)| x * h).sum());
        if center + 3 < count {
            for _ in 0..3 {
                queue.pop_front();
                queue.push_back(match source.next() {
                    Some(v) => v? as f32 / 32768.0,
                    None => 0.0,
                });
            }
        }
    }
    control.check()?;
    Ok(output)
}
fn kernel() -> Vec<f32> {
    let mut taps: Vec<_> = (0..97)
        .map(|i| {
            let x = i as f64 - 48.0;
            let cutoff = 7000.0 / 48000.0;
            let sinc = if x == 0.0 {
                2.0 * cutoff
            } else {
                (2.0 * std::f64::consts::PI * cutoff * x).sin() / (std::f64::consts::PI * x)
            };
            (sinc * (0.54 - 0.46 * (2.0 * std::f64::consts::PI * i as f64 / 96.0).cos())) as f32
        })
        .collect();
    let sum: f32 = taps.iter().sum();
    for x in &mut taps {
        *x /= sum;
    }
    taps
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_normalization_does_not_open_the_track() {
        let control = crate::processing::ProcessingControl::default();
        control.cancel();
        let error =
            normalize_controlled(Path::new("missing-fixture.wav"), 1, &control).unwrap_err();
        assert!(error.is::<crate::processing::ProcessingCancelled>());
    }
    #[test]
    fn amplitude_alias_filter_and_timeline() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("raw.wav");
        for frequency in [1000.0, 12000.0] {
            let mut wav = hound::WavWriter::create(
                &path,
                hound::WavSpec {
                    channels: 1,
                    sample_rate: 48000,
                    bits_per_sample: 16,
                    sample_format: hound::SampleFormat::Int,
                },
            )?;
            for i in 0..48000 {
                wav.write_sample(
                    (16000.0 * (2.0 * std::f64::consts::PI * frequency * i as f64 / 48000.0).sin())
                        as i16,
                )?;
            }
            wav.finalize()?;
            let samples = normalize(&path, 1)?;
            assert_eq!(samples.len(), 16000);
            let rms = (samples[100..15900].iter().map(|v| v * v).sum::<f32>() / 15800.0).sqrt();
            if frequency == 1000.0 {
                assert!((rms - 0.345).abs() < 0.01);
            } else {
                assert!(rms < 0.005);
            }
        }
        Ok(())
    }
}
