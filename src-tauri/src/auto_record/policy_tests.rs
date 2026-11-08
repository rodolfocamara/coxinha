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
fn off() -> Settings {
    Settings::default()
}
fn idle() -> Capture {
    Capture::default()
}
fn recording(meeting: &str) -> Capture {
    Capture {
        active: Some(meeting.into()),
        speech_ago: None,
    }
}
fn spoke(meeting: &str, ago: u64) -> Capture {
    Capture {
        active: Some(meeting.into()),
        speech_ago: Some(Duration::from_secs(ago)),
    }
}
fn secs(s: u64) -> Duration {
    Duration::from_secs(s)
}
fn stop(meeting: &str) -> Option<Command> {
    Some(Command::Stop {
        meeting: meeting.into(),
        app: "Microsoft Teams".into(),
    })
}

#[test]
fn off_never_starts_and_on_starts_once_even_while_the_start_is_in_flight() {
    let mut p = Policy::default();
    let t = Instant::now();
    let c = call(42, 1);
    assert_eq!(p.observe(t, &off(), &[c.clone()], &idle()), None);
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
fn a_manual_recording_never_auto_starts_and_its_stop_does_not_restart_the_call() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    assert_eq!(p.observe(t, &on(), &[c.clone()], &recording("mine")), None);
    assert_eq!(p.observe(t, &on(), &[c.clone()], &idle()), None);
}

#[test]
fn a_manual_capture_stops_a_quiet_minute_after_its_call_with_auto_record_off() {
    let t = Instant::now();
    let c = call(42, 1);
    let live = recording("m1");
    let mut p = Policy::default();
    assert_eq!(p.observe(t, &off(), &[c.clone()], &live), None);
    assert_eq!(p.follow.as_ref().unwrap().calls, vec![c.clone()]);
    assert_eq!(p.observe(t + secs(3), &off(), &[], &live), None);
    assert_eq!(p.stop_at, Some(t + secs(63)));
    assert_eq!(p.observe(t + secs(62), &off(), &[], &live), None);
    assert_eq!(p.observe(t + secs(63), &off(), &[], &live), stop("m1"));
    assert!(p.follow.is_none());
    // The stop is in flight: never commanded twice, never followed again.
    assert_eq!(p.observe(t + secs(66), &off(), &[], &live), None);
    assert_eq!(p.observe(t + secs(200), &off(), &[], &live), None);
    assert!(p.follow.is_none());
    assert_eq!(p.observe(t + secs(203), &off(), &[], &idle()), None);
}

#[test]
fn microphone_speech_restarts_the_minute_and_the_call_coming_back_cancels_it() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    p.observe(t, &off(), &[c.clone()], &recording("m1"));
    p.observe(t + secs(3), &off(), &[], &recording("m1"));
    // The owner speaks 40 s after the call: the stop moves to a minute later.
    let at = t + secs(43);
    assert_eq!(p.observe(at, &off(), &[], &spoke("m1", 0)), None);
    assert_eq!(p.stop_at, Some(at + QUIET_MINUTE));
    assert_eq!(p.observe(t + secs(70), &off(), &[], &spoke("m1", 27)), None);
    assert_eq!(
        p.observe(t + secs(103), &off(), &[], &spoke("m1", 60)),
        stop("m1")
    );

    // A reconnect of the same process is the same call, whatever the episode.
    let mut p = Policy::default();
    p.observe(t, &off(), &[c.clone()], &recording("m2"));
    p.observe(t + secs(3), &off(), &[], &recording("m2"));
    let reconnect = call(42, 50);
    assert_eq!(
        p.observe(t + secs(50), &off(), &[reconnect], &recording("m2")),
        None
    );
    assert_eq!(p.stop_at, None);
    assert_eq!(p.follow.as_ref().unwrap().calls.len(), 1);
    assert_eq!(p.observe(t + secs(56), &off(), &[], &recording("m2")), None);
    assert_eq!(p.stop_at, Some(t + secs(116)));
}

#[test]
fn no_call_the_setting_off_or_keep_recording_never_stop() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    // In person: no call ever, never a countdown.
    for s in [0, 60, 600, 6000] {
        assert_eq!(p.observe(t + secs(s), &off(), &[], &recording("m1")), None);
        assert_eq!(p.stop_at, None);
    }
    let manual_stop = Settings {
        stop_when_call_ends: false,
        ..off()
    };
    let mut p = Policy::default();
    p.observe(t, &manual_stop, &[c.clone()], &recording("m1"));
    for s in [3, 120, 6000] {
        assert_eq!(
            p.observe(t + secs(s), &manual_stop, &[], &recording("m1")),
            None
        );
        assert_eq!(p.stop_at, None);
    }
    let mut p = Policy::default();
    p.observe(t, &off(), &[c.clone()], &recording("m1"));
    p.observe(t + secs(3), &off(), &[], &recording("m1"));
    p.keep();
    assert_eq!(
        p.observe(t + secs(6000), &off(), &[], &recording("m1")),
        None
    );
    assert_eq!(p.stop_at, None);
}

#[test]
fn the_first_call_during_a_capture_and_any_call_while_none_is_followed_join() {
    let t = Instant::now();
    let first = call(42, 1);
    let other = ActiveCall {
        app_name: "Google Chrome".into(),
        process_name: "chrome".into(),
        ..call(77, 2)
    };
    let mut p = Policy::default();
    p.observe(t, &off(), &[], &recording("m1"));
    assert!(p.follow.as_ref().unwrap().calls.is_empty());
    p.observe(t + secs(10), &off(), &[first.clone()], &recording("m1"));
    assert_eq!(p.follow.as_ref().unwrap().calls, vec![first.clone()]);
    p.observe(t + secs(20), &off(), &[], &recording("m1"));
    assert!(p.stop_at.is_some());
    // Another call during the minute: the recording now follows it too.
    p.observe(t + secs(30), &off(), &[other.clone()], &recording("m1"));
    assert_eq!(p.stop_at, None);
    assert!(p.follow.as_ref().unwrap().follows(&other));
    p.observe(t + secs(40), &off(), &[], &recording("m1"));
    let ended = Command::Stop {
        meeting: "m1".into(),
        app: "Microsoft Teams".into(),
    };
    assert_eq!(
        p.observe(t + secs(100), &off(), &[], &recording("m1")),
        Some(ended)
    );
}

#[test]
fn a_failed_poll_restarts_the_minute_and_a_manual_switch_follows_the_new_capture() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    p.observe(t, &off(), &[c.clone()], &recording("m1"));
    p.observe(t + secs(3), &off(), &[], &recording("m1"));
    p.unreliable();
    assert_eq!(p.stop_at, None);
    assert_eq!(p.observe(t + secs(63), &off(), &[], &recording("m1")), None);
    assert_eq!(p.stop_at, Some(t + secs(123)));
    // Stopped by hand and a new one started without a call: nothing follows.
    assert_eq!(
        p.observe(t + secs(130), &off(), &[], &recording("m2")),
        None
    );
    assert!(p.follow.as_ref().unwrap().calls.is_empty());
    assert_eq!(p.stop_at, None);
}

#[test]
fn the_ended_ask_stays_quiet_only_when_the_stop_is_automatic() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    assert!(!p.stops_on_end(&off(), &[c.clone()]));
    p.observe(t, &off(), &[c.clone()], &recording("m1"));
    assert!(p.stops_on_end(&off(), &[c.clone()]));
    assert!(!p.stops_on_end(&off(), &[call(77, 2)]));
    let manual_stop = Settings {
        stop_when_call_ends: false,
        ..off()
    };
    assert!(!p.stops_on_end(&manual_stop, &[c.clone()]));
    p.keep();
    assert!(!p.stops_on_end(&off(), &[c.clone()]));
}

#[test]
fn an_automatic_capture_stops_the_same_way_and_processing_never_blocks_its_start() {
    let t = Instant::now();
    let c = call(42, 1);
    let mut p = Policy::default();
    assert_eq!(
        p.observe(t, &on(), &[c.clone()], &idle()),
        Some(Command::Start(c.clone()))
    );
    p.started("m1".into(), "s1".into(), &c);
    let live = recording("m1");
    assert_eq!(p.observe(t, &on(), &[c.clone()], &live), None);
    assert_eq!(p.observe(t + secs(3), &on(), &[], &live), None);
    assert_eq!(p.stop_at, Some(t + secs(63)));
    assert_eq!(p.observe(t + secs(63), &on(), &[], &live), stop("m1"));
}

#[test]
fn back_to_back_calls_stop_the_old_capture_and_start_the_new_one() {
    let t = Instant::now();
    let first = call(42, 1);
    let second = call(77, 2);
    let live = recording("m1");
    let mut p = Policy::default();
    p.observe(t, &on(), &[first.clone()], &idle());
    p.started("m1".into(), "s1".into(), &first);
    // While the followed call is live, another call is only a prompt.
    assert_eq!(
        p.observe(t, &on(), &[first.clone(), second.clone()], &live),
        None
    );
    let third = call(90, 3);
    p.observe(t, &on(), &[], &live);
    assert_eq!(
        p.observe(t + secs(5), &on(), &[third.clone()], &live),
        Some(Command::StopThenStart {
            meeting: "m1".into(),
            app: "Microsoft Teams".into(),
            call: third.clone()
        })
    );
}
