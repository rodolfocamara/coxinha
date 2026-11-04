//! Integration smoke test: spawns the real `coxinha.exe` and watches
//! stdout/stderr for the shortcut-registration trace lines emitted
//! by `shortcuts::register_all`. Asserts all five default shortcuts
//! register on a clean box + no `failed to register` warnings slip
//! through.
//!
//! Catches three classes of regression that unit tests can't:
//!   1. A default chord that parses but can't be registered on
//!      this OS (the post-spec-0042 bug report shape).
//!   2. A migration that flips the config into a stale set.
//!   3. A change to the shortcut-registration log format that
//!      breaks user-reported diagnostics.
//!
//! Requires a disposable full application profile and a private desktop/session.
//! See tests/README.md; default cargo test cannot launch this binary.

use std::io::{BufRead, BufReader};
mod support;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const SUMMARY_MARKER: &str = "shortcut registration summary:";
const BOOT_WAIT_BUDGET: Duration = Duration::from_secs(10);

#[test]
#[ignore = "native app: requires explicit feature and parent-owned private desktop/session"]
fn all_five_default_shortcuts_register_cleanly() {
    let bin = env!("CARGO_BIN_EXE_coxinha");
    let sandbox = support::NativeSandbox::new();

    let mut child = sandbox.spawn(std::path::Path::new(bin));

    let (tx, rx) = mpsc::channel::<String>();
    spawn_line_pump("stdout", child.stdout.take().expect("stdout"), tx.clone());
    spawn_line_pump("stderr", child.stderr.take().expect("stderr"), tx);

    let collected = drain_until(&rx, SUMMARY_MARKER, BOOT_WAIT_BUDGET);

    let _ = child.kill();
    let _ = child.wait();

    let summary_line = collected
        .iter()
        .find(|l| l.contains(SUMMARY_MARKER))
        .unwrap_or_else(|| {
            panic!(
                "binary never emitted '{SUMMARY_MARKER}' — full log above. \
                 Either shortcuts::register_all didn't run or the log format \
                 drifted. Check src-tauri/src/shortcuts.rs.",
            )
        });

    // Parse "... summary: N ok, M failed" — keep the parser tight so
    // a drift in the format fails loud.
    let (ok, failed) = parse_summary(summary_line);
    assert_eq!(
        ok, 5,
        "expected 5 shortcuts registered, got {ok} (failed={failed}). \
         Log line: {summary_line:?}",
    );
    assert_eq!(
        failed, 0,
        "expected 0 registration failures, got {failed}. Log line: {summary_line:?}. \
         On Windows this usually means a chord is already claimed by the OS or a \
         prior coxinha.exe was force-killed without unregistering — see \
         docs/lessons.md entry on `RegisterHotKey` leaks.",
    );

    // Belt-and-suspenders: count the per-shortcut info lines too so
    // the summary can't lie silently.
    let registered_lines: Vec<_> = collected
        .iter()
        .filter(|l| l.contains("registered shortcut "))
        .collect();
    assert_eq!(
        registered_lines.len(),
        5,
        "expected 5 'registered shortcut' lines, got {}:\n{}",
        registered_lines.len(),
        registered_lines
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    );
}

fn parse_summary(line: &str) -> (u32, u32) {
    // Format: "... shortcut registration summary: N ok, M failed"
    let tail = line
        .split_once(SUMMARY_MARKER)
        .map(|(_, t)| t.trim())
        .unwrap_or("");
    let ok = extract_number_before(tail, " ok").unwrap_or(0);
    let failed = extract_number_before(tail, " failed").unwrap_or(u32::MAX);
    (ok, failed)
}

fn extract_number_before(s: &str, tail: &str) -> Option<u32> {
    let idx = s.find(tail)?;
    // rfind on the DoubleEndedIterator walks from the back in O(1)
    // instead of iterating to the end (clippy::filter_next /
    // clippy::double_ended_iterator_last).
    s[..idx]
        .split(|c: char| !c.is_ascii_digit())
        .rfind(|s| !s.is_empty())?
        .parse()
        .ok()
}

fn spawn_line_pump<R: std::io::Read + Send + 'static>(
    label: &'static str,
    stream: R,
    tx: mpsc::Sender<String>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[child {label}] {line}");
            if tx.send(line).is_err() {
                break;
            }
        }
    });
}

fn drain_until(rx: &mpsc::Receiver<String>, stop_marker: &str, budget: Duration) -> Vec<String> {
    let deadline = Instant::now() + budget;
    let mut lines = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                let hit = line.contains(stop_marker);
                lines.push(line);
                if hit {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    lines
}
