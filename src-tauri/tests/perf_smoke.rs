//! Runtime performance smoke test: spawns the real binary, waits
//! for ready, then samples process RSS and CPU for a fixed window
//! so we catch memory regressions (leaks, unintentional preloads,
//! bloat from a new dep) in an explicitly provisioned private desktop session.
//!
//! This is the measurement feeder for spec 0003 (cold-start-load).
//! The budgets below are calibrated to what a Tauri 2 + webview2 +
//! BlockNote app idles at today — tighten once we have a few
//! hundred runs of history; loosen only with a postmortem.

use std::io::{BufRead, BufReader, Read};
mod support;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// How long we watch the child after it emits the ready marker.
/// 5 seconds is enough to see webview-initiated allocations settle
/// without making the test suite slow.
const SAMPLE_WINDOW: Duration = Duration::from_secs(5);
const SAMPLE_INTERVAL: Duration = Duration::from_millis(100);

/// Hard upper bound on resident memory during the sample window.
/// The Rust side of a Tauri 2 app sits at ~40 MB on Windows idle —
/// webview2 runs in separate child processes and isn't counted here
/// by design (we want to catch leaks in *our* code, not blame
/// Microsoft's webview). 200 MB gives us 5× headroom; a regression
/// past that is almost certainly a real leak in the Rust side.
const RSS_BUDGET_MB: f64 = 200.0;

/// Peak CPU averaged across the sample window. The child should be
/// idle after boot; >25 % average sustained over 5 s points at a
/// runaway loop (call detector misconfigured, autosave thrashing,
/// spin-loop in a background worker).
const AVG_CPU_BUDGET_PCT: f32 = 25.0;

const READY_MARKER: &str = "Coxinha ready";
const BOOT_WAIT_BUDGET: Duration = Duration::from_secs(8);

#[test]
#[ignore = "native app: requires explicit feature and parent-owned private desktop/session"]
fn idle_memory_and_cpu_stay_within_budget() {
    let bin = env!("CARGO_BIN_EXE_coxinha");
    let sandbox = support::NativeSandbox::new();

    let mut child = sandbox.spawn(std::path::Path::new(bin));

    let pid = Pid::from_u32(child.id());

    // Pipe the child's output to a channel so we can block on the
    // ready marker without deadlocking on a full kernel pipe.
    let (tx, rx) = mpsc::channel::<String>();
    pump_lines(child.stdout.take().expect("stdout"), tx.clone());
    pump_lines(child.stderr.take().expect("stderr"), tx);

    let ready_at = wait_for_marker(&rx, READY_MARKER, BOOT_WAIT_BUDGET);
    if ready_at.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        panic!("child never emitted '{}' — see captured logs", READY_MARKER);
    }

    let report = sample(pid, SAMPLE_WINDOW, SAMPLE_INTERVAL);

    let _ = child.kill();
    let _ = child.wait();

    eprintln!("perf_smoke report: {:#?}", report);

    assert!(
        report.peak_rss_mb < RSS_BUDGET_MB,
        "peak RSS {:.1} MB exceeds budget {:.1} MB",
        report.peak_rss_mb,
        RSS_BUDGET_MB
    );
    assert!(
        report.avg_cpu_pct < AVG_CPU_BUDGET_PCT,
        "avg CPU {:.1}% exceeds budget {:.1}% over {:?}",
        report.avg_cpu_pct,
        AVG_CPU_BUDGET_PCT,
        SAMPLE_WINDOW
    );
    // Memory growth over the idle window catches the "slow leak"
    // class — a successful start that then climbs while the user
    // sits idle. Real growth on our current baseline is ~0 MB, so
    // 30 MB is loud enough to flag a regression without being
    // flaky on first-allocator warm-up.
    const GROWTH_BUDGET_MB: f64 = 30.0;
    let growth = report.last_rss_mb - report.first_rss_mb;
    assert!(
        growth < GROWTH_BUDGET_MB,
        "RSS grew {:.1} MB during idle window (first={:.1}, last={:.1})",
        growth,
        report.first_rss_mb,
        report.last_rss_mb
    );
}

/// All fields are read through the `Debug` print at the end of the
/// test; the dead-code lint doesn't count that as a use, hence the
/// explicit allow.
#[derive(Debug)]
#[allow(dead_code)]
struct Report {
    samples: usize,
    first_rss_mb: f64,
    last_rss_mb: f64,
    peak_rss_mb: f64,
    avg_cpu_pct: f32,
    peak_cpu_pct: f32,
}

fn sample(pid: Pid, window: Duration, interval: Duration) -> Report {
    let mut sys = System::new();
    // Prime the process entry so the first CPU delta is sensible —
    // sysinfo returns 0% on the very first refresh.
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::everything(),
    );
    thread::sleep(interval);

    let mut rss_mb_samples: Vec<f64> = Vec::new();
    let mut cpu_pct_samples: Vec<f32> = Vec::new();

    let deadline = Instant::now() + window;
    while Instant::now() < deadline {
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::everything(),
        );
        if let Some(proc) = sys.process(pid) {
            // `memory()` is RSS in bytes on every supported OS.
            rss_mb_samples.push(proc.memory() as f64 / 1_048_576.0);
            cpu_pct_samples.push(proc.cpu_usage());
        } else {
            // Process vanished — the child crashed; stop sampling
            // and let the assertions in the caller fail with a
            // useful message.
            break;
        }
        thread::sleep(interval);
    }

    let first = rss_mb_samples.first().copied().unwrap_or(0.0);
    let last = rss_mb_samples.last().copied().unwrap_or(0.0);
    let peak = rss_mb_samples.iter().copied().fold(0.0f64, f64::max);
    let avg_cpu = if cpu_pct_samples.is_empty() {
        0.0
    } else {
        cpu_pct_samples.iter().sum::<f32>() / cpu_pct_samples.len() as f32
    };
    let peak_cpu = cpu_pct_samples.iter().copied().fold(0.0f32, f32::max);

    Report {
        samples: rss_mb_samples.len(),
        first_rss_mb: first,
        last_rss_mb: last,
        peak_rss_mb: peak,
        avg_cpu_pct: avg_cpu,
        peak_cpu_pct: peak_cpu,
    }
}

fn pump_lines<R: Read + Send + 'static>(stream: R, tx: mpsc::Sender<String>) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[child] {}", line);
            if tx.send(line).is_err() {
                break;
            }
        }
    });
}

fn wait_for_marker(rx: &mpsc::Receiver<String>, marker: &str, budget: Duration) -> Option<Instant> {
    let deadline = Instant::now() + budget;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match rx.recv_timeout(remaining) {
            Ok(line) if line.contains(marker) => return Some(Instant::now()),
            Ok(_) => continue,
            Err(_) => return None,
        }
    }
}
