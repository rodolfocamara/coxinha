use super::{
    plan::{commit, plan, Window, BACKLOG_GROW, CONTEXT, MARGIN, MAX_WINDOW, WINDOW},
    timing::Timing,
    AsrWord,
};
use crate::{
    capture::{Recording, Track},
    store::Store,
};

const S: u64 = 48_000;

#[test]
fn windows_hold_10_s_with_context_and_grow_to_20_s_with_backlog() {
    // First window: no context available yet, 10 s of new audio.
    let w = plan(0, 12 * S, 0, None, false).unwrap();
    assert_eq!(
        (w.start, w.end, w.commit_limit),
        (0, 10 * S, Some(10 * S - MARGIN))
    );
    // Steady state: 1.5 s of left context, 8.5 s of new audio, commit 8 s.
    let w = plan(20 * S, 31 * S, 0, None, false).unwrap();
    assert_eq!(w.start, 20 * S - CONTEXT);
    assert_eq!(w.end - w.start, WINDOW);
    assert_eq!(w.commit_limit.unwrap() - w.cursor, 8 * S);
    // Not enough committed audio for a full window while the capture runs.
    assert_eq!(plan(20 * S, 28 * S, 0, None, false), None);
    // Backlog growth: 10 s up to 30 s behind, then linear up to 20 s at 60 s.
    let total = |backlog: u64| {
        let w = plan(100 * S, 100 * S + backlog, 0, None, false).unwrap();
        w.end - w.start
    };
    assert_eq!(total(BACKLOG_GROW), WINDOW);
    assert_eq!(total(45 * S), 15 * S);
    assert_eq!(total(60 * S), MAX_WINDOW);
    assert_eq!(total(600 * S), MAX_WINDOW);
    const { assert!(MAX_WINDOW + 96 <= crate::capture::MAX_READ_FRAMES) };
}

#[test]
fn context_stays_inside_the_pause_span_and_on_the_decimation_grid() {
    // Cursor right after a resume at frame 100_001: no context crosses it.
    let w = plan(100_001, 40 * S, 100_001, None, false).unwrap();
    assert_eq!(w.start, 99_999);
    assert_eq!(w.start % 3, 0);
    // A pause boundary ahead turns the tail before it into a final window.
    let w = plan(10 * S, 40 * S, 0, Some(12 * S), false).unwrap();
    assert_eq!((w.end, w.commit_limit), (12 * S, None));
    // The boundary is ahead of the snapshot: wait, the audio may still grow.
    assert_eq!(plan(10 * S, 11 * S, 0, Some(12 * S), false), None);
    // End flushes the tail, including audio inside the margin.
    let w = plan(10 * S, 11 * S, 0, None, true).unwrap();
    assert_eq!((w.end, w.commit_limit), (11 * S, None));
    assert_eq!(plan(11 * S, 11 * S, 0, None, true), None);
}

fn word(window: &Window, t0: u64, t1: u64, text: &str) -> AsrWord {
    AsrWord {
        t0_ms: ((t0 - window.start) / 48) as u32,
        t1_ms: ((t1 - window.start) / 48) as u32,
        text: text.into(),
    }
}

#[test]
fn words_ending_inside_the_margin_are_decoded_again() {
    let w = plan(20 * S, 40 * S, 0, None, false).unwrap();
    let limit = w.commit_limit.unwrap();
    let words = [
        word(&w, w.start, w.start + S, "context"),
        word(&w, w.cursor - S / 10, w.cursor + S / 10, "straddles-cursor"),
        word(&w, w.cursor + S, w.cursor + 2 * S, "kept"),
        word(&w, limit - S / 5, limit + S / 5, "held"),
        word(&w, limit + S / 10, limit + S / 5, "margin"),
    ];
    let c = commit(&w, &words);
    let texts: Vec<_> = c.words.iter().map(|w| w.2.as_str()).collect();
    assert_eq!(texts, ["straddles-cursor", "kept"]);
    assert_eq!(c.next, limit - S / 5);
    // Without a held word, the cursor moves to the commit limit.
    let c = commit(&w, &words[..3]);
    assert_eq!(c.next, limit);
}

/// Simulated live stream: every word is reported by any window that sees part
/// of it, clipped to the window, as a decoder would.
#[test]
fn stitching_over_a_live_stream_loses_and_duplicates_no_word() {
    let total = 300 * S;
    let words: Vec<(u64, u64)> = (0..)
        .map(|n: u64| {
            let at = n * 37 * S / 100 + (n % 7) * 500;
            (at, at + S / 5 + (n % 5) * 1_000)
        })
        .take_while(|w| w.1 < total)
        .collect();
    let mut cursor = 0;
    let mut committed = 0;
    let mut seen = Vec::new();
    let mut sizes = Vec::new();
    for step in 0.. {
        // Two stalls let the backlog exceed 30 s, so windows grow.
        let arrival = if step == 10 || step == 40 {
            60 * S
        } else {
            2 * S
        };
        committed = (committed + arrival).min(total);
        let ended = committed == total;
        let Some(w) = plan(cursor, committed, 0, None, ended) else {
            if ended {
                break;
            }
            continue;
        };
        sizes.push(w.end - w.start);
        let visible: Vec<AsrWord> = words
            .iter()
            .enumerate()
            .filter(|(_, (a, b))| *b > w.start && *a < w.end)
            .map(|(n, (a, b))| AsrWord {
                t0_ms: ((a.max(&w.start) - w.start) / 48) as u32,
                t1_ms: ((b.min(&w.end) - w.start) / 48) as u32,
                text: format!("w{n}"),
            })
            .collect();
        let c = commit(&w, &visible);
        assert!(c.next > cursor);
        seen.extend(c.words.into_iter().map(|w| w.2));
        cursor = c.next;
    }
    let expected: Vec<String> = (0..words.len()).map(|n| format!("w{n}")).collect();
    assert_eq!(seen, expected);
    assert!(sizes.contains(&WINDOW) && sizes.iter().any(|s| *s > WINDOW));
    assert!(sizes.iter().all(|s| *s <= MAX_WINDOW));
}

#[test]
fn pause_boundaries_come_from_the_recorder_journal() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path())?;
    let meeting = store.create_meeting("pause boundaries")?;
    let mut r = Recording::start(&store, &meeting, "mic", "output")?;
    r.write_block(Track::Mic, &[1; 4000], 0)?;
    r.write_block(Track::Output, &[1; 3000], 0)?;
    r.pause(true, 1)?;
    r.write_block(Track::Mic, &[1; 960], 2)?;
    r.write_block(Track::Mic, &[1; 960], 3)?;
    r.write_block(Track::Output, &[1; 500], 3)?;
    r.pause(false, 4)?;
    r.write_block(Track::Mic, &[1; 4000], 5)?;
    r.checkpoint()?;
    let mut timing = Timing::default();
    let journal = store.root.join("raw").join(&meeting).join("timing.jsonl");
    timing.update(&journal)?;
    assert_eq!(timing.span(Track::Mic, 0), (0, Some(4000)));
    assert_eq!(timing.span(Track::Mic, 4000), (4000, None));
    assert_eq!(timing.span(Track::Output, 10), (0, Some(3000)));
    // Paused audio is added back on the capture clock after the boundary.
    assert_eq!(timing.paused_before(Track::Mic, 3999), 0);
    assert_eq!(timing.paused_before(Track::Mic, 4000), 1920);
    assert_eq!(timing.paused_before(Track::Output, 3000), 500);
    // Incremental: only appended lines are read on the next update.
    r.pause(true, 6)?;
    r.checkpoint()?;
    timing.update(&journal)?;
    assert_eq!(timing.span(Track::Mic, 5000), (4000, Some(8000)));
    Ok(())
}
