//! Integration smoke test: launches the real `coxinha.exe` binary,
//! waits for the `Coxinha ready` tracing line, measures the elapsed
//! time, and kills the child.
//!
//! This is the test that would have caught both the
//! `plugins.autostart` schema drift and the Whisper-feature-missing
//! panic — neither of which showed up in unit tests because neither
//! failure lives inside a pure function.
//!
//! The boot budget is deliberately generous (8s wait, 5s ready bar).
//! The real cold-start SLA comes from spec 0003; this test only
//! guards against order-of-magnitude regressions.

use std::io::{BufRead, BufReader};
mod support;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const READY_MARKER: &str = "Coxinha ready";
// UX requirement: boot-to-ready fits in 2 s. BOOT_WAIT_BUDGET is
// the stdout reader timeout — slack so CI doesn't hang if the
// marker never arrives — not the perf limit.
const BOOT_WAIT_BUDGET: Duration = Duration::from_secs(8);
const BOOT_READY_BUDGET: Duration = Duration::from_secs(2);

#[test]
#[ignore = "native app: requires explicit feature and parent-owned private desktop/session"]
fn app_boots_and_emits_ready_within_budget() {
    let bin = env!("CARGO_BIN_EXE_coxinha");
    let sandbox = support::NativeSandbox::new();

    let start = Instant::now();
    let mut child = sandbox.spawn(std::path::Path::new(bin));

    // Tracing's default fmt layer writes to stdout; some libraries
    // log to stderr. Stream both to a single channel so either carries
    // the ready marker.
    let (tx, rx) = mpsc::channel::<String>();
    spawn_line_pump("stdout", child.stdout.take().expect("stdout"), tx.clone());
    spawn_line_pump("stderr", child.stderr.take().expect("stderr"), tx);

    let ready_at = wait_for_marker(&rx, start, READY_MARKER, BOOT_WAIT_BUDGET);

    // The child is tray-resident and never exits on its own.
    let _ = child.kill();
    let _ = child.wait();

    let ready =
        ready_at.expect("binary never emitted 'Coxinha ready' — check stdout/stderr dumped above");
    eprintln!("boot-ready elapsed: {:?}", ready);

    assert!(
        ready < BOOT_READY_BUDGET,
        "boot-ready took {:?}, expected under {:?}",
        ready,
        BOOT_READY_BUDGET
    );
}

fn spawn_line_pump<R: std::io::Read + Send + 'static>(
    label: &'static str,
    stream: R,
    tx: mpsc::Sender<String>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[child {}] {}", label, line);
            if tx.send(line).is_err() {
                break;
            }
        }
    });
}

fn wait_for_marker(
    rx: &mpsc::Receiver<String>,
    start: Instant,
    marker: &str,
    budget: Duration,
) -> Option<Duration> {
    let deadline = start + budget;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match rx.recv_timeout(remaining) {
            Ok(line) if line.contains(marker) => return Some(start.elapsed()),
            Ok(_) => continue,
            Err(mpsc::RecvTimeoutError::Timeout) => return None,
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    }
}
