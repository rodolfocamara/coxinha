use super::*;
use std::sync::Mutex;

fn line(start_ms: u64, text: &str) -> TranscriptLine {
    TranscriptLine {
        start_ms,
        speaker_hint: Some("Ana".into()),
        text: text.into(),
    }
}

fn run<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(future)
}

#[test]
fn a_short_transcript_is_one_request() {
    let asked = Mutex::new(Vec::new());
    let out = run(summarize_with(
        &[line(0, "Fechamos a meta de 99,5% então.")],
        1500,
        |p| {
            asked.lock().unwrap().push(p.clone());
            async { Ok("## Resumo\nMeta fechada.".to_string()) }
        },
    ))
    .unwrap();
    assert_eq!(out, "## Resumo\nMeta fechada.");
    let asked = asked.into_inner().unwrap();
    assert_eq!(asked.len(), 1);
    assert!(asked[0].user.contains("[00:00] Ana: Fechamos a meta"));
}

#[test]
fn a_long_transcript_maps_every_part_within_the_cap_then_reduces() {
    let lines: Vec<_> = (0..40)
        .map(|i| {
            line(
                i * 1000,
                &format!("fala {i} sobre o orçamento que não fecha"),
            )
        })
        .collect();
    let asked = Mutex::new(Vec::new());
    let budget = 60;
    let out = run(summarize_with(&lines, budget, |p| {
        asked.lock().unwrap().push(p.clone());
        let answer = if p.user.starts_with("Part") {
            "- ponto".to_string()
        } else {
            "## Resumo\nTudo.".to_string()
        };
        async move { Ok(answer) }
    }))
    .unwrap();
    assert_eq!(out, "## Resumo\nTudo.");
    let asked = asked.into_inner().unwrap();
    let parts: Vec<_> = asked
        .iter()
        .filter(|p| p.user.starts_with("Part"))
        .collect();
    assert!(parts.len() > 1);
    for p in &parts {
        let body = p.user.split("<transcript>\n").nth(1).unwrap();
        let body = body.split("\n</transcript>").next().unwrap();
        assert!(estimate_tokens(body) <= budget, "{body}");
    }
    // Every line reached some part, in order.
    let sent: String = parts.iter().map(|p| p.user.clone()).collect();
    assert!(sent.contains("fala 0 ") && sent.contains("fala 39 "));
    assert!(asked.last().unwrap().user.contains("<notes>"));
}

#[test]
fn notes_that_never_shrink_stop_after_bounded_rounds() {
    let lines: Vec<_> = (0..30)
        .map(|i| line(i * 1000, &format!("linha {i} de conversa")))
        .collect();
    let calls = Mutex::new(0usize);
    let out = run(summarize_with(&lines, 30, |p| {
        *calls.lock().unwrap() += 1;
        let answer = if p.user.starts_with("The block below holds notes taken") {
            "## Resumo\nOk.".to_string()
        } else {
            "- ".to_string() + &"palavra ".repeat(40)
        };
        async move { Ok(answer) }
    }));
    assert_eq!(out.unwrap(), "## Resumo\nOk.");
    assert!(*calls.lock().unwrap() < 200);
}

#[test]
fn transport_errors_and_unusable_answers_fail_without_text() {
    let lines = [line(0, "oi")];
    let err = run(summarize_with(&lines, 1500, |_| async {
        Err::<String, _>("ssh down".to_string())
    }))
    .unwrap_err();
    assert_eq!(err, SummaryError::Transport("ssh down".into()));
    let err = run(summarize_with(&lines, 1500, |_| async {
        Ok("<think>hmm".to_string())
    }))
    .unwrap_err();
    assert_eq!(err, SummaryError::Unusable);
    let err = run(summarize_with(&[line(0, "  ")], 1500, |_| async {
        Ok("x".to_string())
    }))
    .unwrap_err();
    assert_eq!(err, SummaryError::Empty);
}

#[test]
fn backoff_doubles_from_one_minute_up_to_six_hours() {
    assert_eq!(backoff(1), Duration::from_secs(60));
    assert_eq!(backoff(2), Duration::from_secs(120));
    assert_eq!(backoff(4), Duration::from_secs(480));
    assert_eq!(backoff(30), Duration::from_secs(6 * 3600));
}
