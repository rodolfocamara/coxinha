use super::*;

fn line(start_ms: u64, speaker: Option<&str>, text: &str) -> TranscriptLine {
    TranscriptLine {
        start_ms,
        speaker_hint: speaker.map(str::to_owned),
        text: text.into(),
    }
}

/// One line every 30 s for an hour, each about 40 characters.
fn meeting() -> Vec<TranscriptLine> {
    (0..120)
        .map(|i| {
            line(
                i * 30_000,
                Some("S1"),
                &format!("line number {i:03} of the meeting"),
            )
        })
        .collect()
}

#[test]
fn estimate_counts_three_characters_per_token_rounding_up() {
    assert_eq!(estimate_tokens(""), 0);
    assert_eq!(estimate_tokens("abc"), 1);
    assert_eq!(estimate_tokens("abcd"), 2);
    // Characters, not bytes: three two-byte characters are one token.
    assert_eq!(estimate_tokens("\u{e3}\u{e7}\u{e9}"), 1);
}

#[test]
fn renders_timestamp_and_speaker_on_one_line_and_skips_silence() {
    let lines = [
        line(65_000, Some("Ana"), "  bom\n dia  "),
        line(66_000, None, "sem falante"),
        line(67_000, Some(" "), "falante vazio"),
        line(68_000, Some("Ana"), " \n "),
    ];
    let excerpt = build_excerpt(&lines, ExcerptMode::FirstMinutes(5), 1500);
    assert_eq!(
        excerpt,
        "[01:05] Ana: bom dia\n[01:06] sem falante\n[01:07] falante vazio"
    );
}

#[test]
fn first_minutes_cuts_at_the_boundary() {
    let excerpt = build_excerpt(&meeting(), ExcerptMode::FirstMinutes(5), 1500);
    let stamps: Vec<&str> = excerpt.lines().map(|l| &l[..7]).collect();
    assert_eq!(
        stamps.len(),
        10,
        "0:00 to 4:30, the 5:00 line starts outside"
    );
    assert_eq!((stamps[0], stamps[9]), ("[00:00]", "[04:30]"));
}

#[test]
fn first_minutes_respects_the_cap_with_whole_lines() {
    let excerpt = build_excerpt(&meeting(), ExcerptMode::FirstMinutes(60), 50);
    assert!(excerpt.chars().count() <= 150);
    assert!(estimate_tokens(&excerpt) <= 50);
    assert!(
        excerpt.lines().all(|l| l.ends_with("of the meeting")),
        "{excerpt}"
    );
    assert!(excerpt.starts_with("[00:00]"));
}

#[test]
fn sampled_spreads_across_the_whole_meeting_within_the_cap() {
    let lines = meeting();
    let excerpt = build_excerpt(&lines, ExcerptMode::Sampled, 100);
    assert!(
        estimate_tokens(&excerpt) <= 100,
        "{}",
        estimate_tokens(&excerpt)
    );
    let picked: Vec<&str> = excerpt.lines().collect();
    assert!(picked.len() >= 4, "{excerpt}");
    assert!(picked[0].starts_with("[00:00]"), "starts at the beginning");
    assert!(
        picked.last().unwrap().contains("line number 119"),
        "ends at the end"
    );
    let numbers: Vec<usize> = picked
        .iter()
        .map(|l| l.split("number ").nth(1).unwrap()[..3].parse().unwrap())
        .collect();
    let gaps: Vec<usize> = numbers.windows(2).map(|w| w[1] - w[0]).collect();
    let (min, max) = (gaps.iter().min().unwrap(), gaps.iter().max().unwrap());
    assert!(max - min <= 1, "evenly spaced: {gaps:?}");
}

#[test]
fn sampled_keeps_everything_when_it_fits() {
    let lines = meeting();
    let excerpt = build_excerpt(&lines[..3], ExcerptMode::Sampled, 1500);
    assert_eq!(excerpt.lines().count(), 3);
}

#[test]
fn a_single_overlong_line_is_cut_on_a_character_boundary() {
    let text = "\u{e7}".repeat(500);
    for mode in [ExcerptMode::FirstMinutes(5), ExcerptMode::Sampled] {
        let excerpt = build_excerpt(&[line(0, None, &text)], mode, 10);
        assert_eq!(excerpt.chars().count(), 30);
        assert!(excerpt.starts_with("[00:00] \u{e7}"));
    }
}

#[test]
fn empty_input_gives_an_empty_excerpt() {
    assert_eq!(build_excerpt(&[], ExcerptMode::Sampled, 1500), "");
    assert_eq!(
        build_excerpt(&meeting(), ExcerptMode::FirstMinutes(0), 1500),
        ""
    );
}
