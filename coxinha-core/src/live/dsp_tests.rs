use super::dsp::{dc_gain, decimate, has_voice};

/// Energy centroid of the decimated response, in absolute 48 kHz frames.
fn centroid(out: &[f32], start: u64) -> f64 {
    let energy: f64 = out.iter().map(|v| (*v as f64).powi(2)).sum();
    out.iter()
        .enumerate()
        .map(|(i, v)| (start + 3 * i as u64) as f64 * (*v as f64).powi(2))
        .sum::<f64>()
        / energy
}

#[test]
fn fir_impulse_lands_on_its_absolute_frame_within_1_ms() {
    assert!((dc_gain() - 1.0).abs() < 1e-5);
    for impulse in [100_000u64, 100_001, 100_002, 100_047, 123_457] {
        // Reads that begin at every phase relative to the decimation grid.
        for read_start in [impulse - 1_000, impulse - 999, impulse - 998, impulse - 48] {
            let pcm: Vec<i16> = (read_start..read_start + 4_000)
                .map(|f| if f == impulse { 30_000 } else { 0 })
                .collect();
            let start = read_start.div_ceil(3) * 3;
            let out = decimate(&pcm, read_start, start, read_start + 3_000);
            let error_frames = (centroid(&out, start) - impulse as f64).abs();
            // 48 frames are 1 ms; the centroid is in fact within one frame.
            assert!(
                error_frames < 1.0,
                "{impulse} from {read_start}: {error_frames}"
            );
            // On the grid, the peak is exact: zero group delay.
            if impulse % 3 == 0 {
                let peak = (0..out.len())
                    .max_by(|a, b| out[*a].abs().total_cmp(&out[*b].abs()))
                    .unwrap();
                assert_eq!(start + 3 * peak as u64, impulse);
            }
        }
    }
}

#[test]
fn fir_keeps_speech_band_and_rejects_alias_band() {
    let gain = |hz: f64| {
        let pcm: Vec<i16> = (0..48_000)
            .map(|n| {
                (10_000.0 * (2.0 * std::f64::consts::PI * hz * n as f64 / 48_000.0).sin()) as i16
            })
            .collect();
        let out = decimate(&pcm, 0, 4_800, 43_200);
        let rms = (out.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / out.len() as f64).sqrt();
        rms * 32768.0 / (10_000.0 / 2f64.sqrt())
    };
    assert!((gain(1_000.0) - 1.0).abs() < 0.01);
    assert!(gain(4_000.0) > 0.95);
    assert!(gain(12_000.0) < 0.001);
}

fn tone(seconds: f64, dbfs: f64) -> Vec<i16> {
    let amplitude = 32768.0 * 10f64.powf(dbfs / 20.0) * 2f64.sqrt();
    (0..(seconds * 48_000.0) as usize)
        .map(|n| {
            (amplitude * (2.0 * std::f64::consts::PI * 300.0 * n as f64 / 48_000.0).sin()) as i16
        })
        .collect()
}

#[test]
fn voice_activity_is_judged_per_50_ms_frame() {
    // One second at −45 dBFS inside nine of silence: the window mean is about
    // −55 dBFS, yet the window is kept because single frames exceed −50.
    let mut window = vec![0i16; 4 * 48_000];
    window.extend(tone(1.0, -45.0));
    window.extend(vec![0i16; 5 * 48_000]);
    assert!(has_voice(&window));
    // A single loud 50 ms frame is enough.
    let mut click = vec![0i16; 10 * 48_000];
    click[5 * 48_000..5 * 48_000 + 2_400].copy_from_slice(&tone(0.05, -40.0));
    assert!(has_voice(&click));
    // Low noise everywhere and digital silence are skipped.
    assert!(!has_voice(&tone(10.0, -55.0)));
    assert!(!has_voice(&vec![0i16; 10 * 48_000]));
}
