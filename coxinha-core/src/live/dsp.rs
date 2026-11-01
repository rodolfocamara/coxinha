//! 48→16 kHz decimation and frame-level voice activity.
use std::sync::OnceLock;

/// Taps on each side of the centre; equals the 48 context frames that
/// `CommittedTrack` allows around a window (spec 0089).
pub(crate) const HALF: u64 = 48;
pub(crate) const FACTOR: u64 = 3;
/// 50 ms at 48 kHz.
const VAD_FRAME: usize = 2400;
const VAD_DBFS: f64 = -50.0;
/// Cutoff below the 8 kHz output Nyquist so the Blackman transition band
/// (about 2.7 kHz wide at 97 taps) mostly stays out of the alias region.
const CUTOFF_HZ: f64 = 7000.0;

fn taps() -> &'static [f32] {
    static TAPS: OnceLock<Vec<f32>> = OnceLock::new();
    TAPS.get_or_init(|| {
        let n = (2 * HALF + 1) as usize;
        let fc = CUTOFF_HZ / 48_000.0;
        let raw: Vec<f64> = (0..n)
            .map(|i| {
                let k = i as f64 - HALF as f64;
                let sinc = if k == 0.0 {
                    2.0 * fc
                } else {
                    (2.0 * std::f64::consts::PI * fc * k).sin() / (std::f64::consts::PI * k)
                };
                let x = 2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64;
                sinc * (0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos())
            })
            .collect();
        let gain: f64 = raw.iter().sum();
        raw.iter().map(|t| (t / gain) as f32).collect()
    })
}

/// Decimates absolute frames `start..end` (`start % 3 == 0`). `pcm` holds the
/// frames from `pcm_start`; frames outside it count as silence. The filter is
/// symmetric around each output frame `3k`, so its group delay is zero and the
/// output sample `i` sits exactly at absolute frame `start + 3i`.
pub(crate) fn decimate(pcm: &[i16], pcm_start: u64, start: u64, end: u64) -> Vec<f32> {
    debug_assert_eq!(start % FACTOR, 0);
    let taps = taps();
    let pcm_end = pcm_start + pcm.len() as u64;
    (start..end)
        .step_by(FACTOR as usize)
        .map(|centre| {
            let first = centre.saturating_sub(HALF).max(pcm_start);
            let last = (centre + HALF + 1).min(pcm_end);
            (first..last)
                .map(|frame| {
                    let tap = (frame + HALF - centre) as usize;
                    taps[tap] * pcm[(frame - pcm_start) as usize] as f32
                })
                .sum::<f32>()
                / 32768.0
        })
        .collect()
}

/// A window is speech unless every 50 ms frame stays at or below −50 dBFS RMS.
pub(crate) fn has_voice(pcm: &[i16]) -> bool {
    let threshold = 10f64.powf(VAD_DBFS / 10.0) * 32768.0 * 32768.0;
    pcm.chunks(VAD_FRAME).any(|frame| {
        let power = frame.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / frame.len() as f64;
        power > threshold
    })
}

#[cfg(test)]
pub(crate) fn dc_gain() -> f32 {
    taps().iter().sum()
}
