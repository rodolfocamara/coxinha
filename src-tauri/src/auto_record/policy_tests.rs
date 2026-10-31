#![allow(clippy::cloned_ref_to_slice_refs)] // Literal call lists read better in tests.
use super::*;

fn call(pid: u32, at: i64) -> ActiveCall {
    ActiveCall {
        app_name: "Microsoft Teams".into(),
        process_name: "teams".into(),
        pid,
        is_browser: false,
        detected_at: chrono::DateTime::from_timestamp(at, 0).unwrap(),
    }
}
fn on() -> Settings {
    Settings {
        enabled: true,
        ..Settings::default()
    }
}
fn idle() -> Capture {
    Capture::default()
}
fn recording(meeting: &str) -> Capture {
    Capture {
        active: Some(meeting.into()),
        busy: false,
    }
}
fn bind(p: &mut Policy, c: &ActiveCall, meeting: &str) {
    p.started(Binding {
        call: c.clone(),
        meeting: meeting.into(),
        session: format!("s-{meeting}"),
        keep: false,
    });
}

#[test]
fn off_never_starts_and_on_starts_once_even_while_the_start_is_in_flight() {
    let mut p = Policy::default();
    let t = Instant::now();
    let c = call(42, 1);
    assert_eq!(
        p.observe(t, &Settings::default(), &[c.clone()], &idle()),
        None
    );
    // A call seen while the setting was off is never recorded later.
    assert_eq!(p.observe(t, &on(), &[c.clone()], &idle()), None);
    let mut p = Policy::default();
    assert_eq!(
        p.observe(t, &on(), &[c.clone()], &idle()),
        Some(Command::Start(c.clone()))
    );
    assert_eq!(p.observe(t, &on(), &[c.clone()], &idle()), None);
    p.start_failed();
    // A failed start is not retried in a loop.
    assert_eq!(p.observe(t, &on(), &[c.clone()], &idle()), None);
}

#[test]
fn a_busy_library_or_a_manual_recording_never_auto_starts() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    let busy = Capture {
        active: None,
        busy: true,
    };
    assert_eq!(p.observe(t, &on(), &[c.clone()], &busy), None);
    // Processing finished while the call goes on: it starts late, once.
    assert_eq!(
        p.observe(t, &on(), &[c.clone()], &idle()),
        Some(Command::Start(c.clone()))
    );
    let mut p = Policy::default();
    assert_eq!(p.observe(t, &on(), &[c.clone()], &recording("mine")), None);
    // Pressing Stop on the manual recording does not restart that call.
    assert_eq!(p.observe(t, &on(), &[c.clone()], &idle()), None);
}

#[test]
fn the_bound_call_ending_stops_after_the_grace_and_a_return_cancels_it() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    p.observe(t, &on(), &[c.clone()], &idle());
    bind(&mut p, &c, "m1");
    let live = recording("m1");
    assert_eq!(p.observe(t, &on(), &[c.clone()], &live), None);
    assert_eq!(p.observe(t, &on(), &[], &live), None);
    assert_eq!(p.stop_at, Some(t + STOP_GRACE));
    assert_eq!(
        p.observe(t + Duration::from_secs(10), &on(), &[c.clone()], &live),
        None
    );
    assert_eq!(p.stop_at, None);
    let later = t + Duration::from_secs(30);
    assert_eq!(p.observe(later, &on(), &[], &live), None);
    assert_eq!(
        p.observe(later + STOP_GRACE, &on(), &[], &live),
        Some(Command::Stop("m1".into()))
    );
    assert!(p.binding.is_none());
}

#[test]
fn a_failed_poll_keep_and_disabled_auto_stop_cancel_the_countdown() {
    let t = Instant::now();
    let c = call(42, 1);
    let live = recording("m1");
    let mut p = Policy::default();
    p.observe(t, &on(), &[c.clone()], &idle());
    bind(&mut p, &c, "m1");
    p.observe(t, &on(), &[], &live);
    p.unreliable();
    assert_eq!(p.stop_at, None);
    p.observe(t + STOP_GRACE, &on(), &[], &live);
    p.keep();
    assert_eq!(p.observe(t + STOP_GRACE * 5, &on(), &[], &live), None);
    let mut p = Policy::default();
    p.observe(t, &on(), &[c.clone()], &idle());
    bind(&mut p, &c, "m1");
    let manual_stop = Settings {
        stop_when_call_ends: false,
        ..on()
    };
    assert_eq!(p.observe(t, &manual_stop, &[], &live), None);
    assert_eq!(
        p.observe(t + STOP_GRACE * 5, &manual_stop, &[], &live),
        None
    );
}

#[test]
fn a_manual_stop_or_switch_clears_the_binding() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    p.observe(t, &on(), &[c.clone()], &idle());
    bind(&mut p, &c, "m1");
    assert_eq!(p.observe(t, &on(), &[], &recording("other")), None);
    assert!(p.binding.is_none());
    assert_eq!(
        p.observe(t + STOP_GRACE * 2, &on(), &[], &recording("other")),
        None
    );
}

#[test]
fn back_to_back_calls_stop_the_old_capture_and_start_the_new_one() {
    let t = Instant::now();
    let first = call(42, 1);
    let second = call(77, 2);
    let live = recording("m1");
    let mut p = Policy::default();
    p.observe(t, &on(), &[first.clone()], &idle());
    bind(&mut p, &first, "m1");
    // While the bound call is live, another call is only a prompt.
    assert_eq!(
        p.observe(t, &on(), &[first.clone(), second.clone()], &live),
        None
    );
    let third = call(90, 3);
    p.observe(t, &on(), &[], &live);
    assert_eq!(
        p.observe(t + Duration::from_secs(5), &on(), &[third.clone()], &live),
        Some(Command::StopThenStart("m1".into(), third.clone()))
    );
}
