use super::*;
use serde_json::json;

fn event(id: &str, title: &str, start: &str, end: &str) -> Event {
    serde_json::from_value(json!({
        "id": id, "title": title, "startsAt": start, "endsAt": end,
        "cancelled": false, "allDay": false,
        "attendees": [{"name": "Rita Souza", "email": "rita@example.com"}, {"name": "Rita", "email": "RITA@example.com"}],
        "organizer": {"name": "Marcos", "email": null}
    }))
    .unwrap()
}
fn at(value: &str) -> DateTime<Utc> {
    instant(value).unwrap()
}

#[test]
fn picks_the_running_event_with_the_nearest_start_and_ignores_cancelled_or_all_day() {
    let weekly = event(
        "w",
        "Weekly de TI",
        "2026-10-31T10:00:00Z",
        "2026-10-31T10:45:00Z",
    );
    let block = event(
        "b",
        "Bloco de foco",
        "2026-10-31T09:00:00Z",
        "2026-10-31T12:00:00Z",
    );
    let mut cancelled = event(
        "c",
        "Cancelada",
        "2026-10-31T10:05:00Z",
        "2026-10-31T10:30:00Z",
    );
    cancelled.cancelled = true;
    let mut all_day = event(
        "d",
        "Feriado",
        "2026-10-31T00:00:00Z",
        "2026-11-01T00:00:00Z",
    );
    all_day.all_day = true;
    let events = vec![block.clone(), weekly.clone(), cancelled, all_day];
    assert_eq!(
        current_event(&events, at("2026-10-31T10:03:00Z"))
            .unwrap()
            .id,
        "w"
    );
    // Ten minutes early still counts; after the end it does not.
    assert_eq!(
        current_event(&events, at("2026-10-31T09:52:00Z"))
            .unwrap()
            .id,
        "w"
    );
    assert_eq!(
        current_event(&events, at("2026-10-31T11:00:00Z"))
            .unwrap()
            .id,
        "b"
    );
    assert!(current_event(&events, at("2026-10-31T13:00:00Z")).is_none());
    // Same start: the shorter event wins.
    let short = event(
        "s",
        "Rápida",
        "2026-10-31T10:00:00Z",
        "2026-10-31T10:15:00Z",
    );
    assert_eq!(
        current_event(&[weekly, short], at("2026-10-31T10:01:00Z"))
            .unwrap()
            .id,
        "s"
    );
}

#[test]
fn reuses_a_free_planned_session_with_the_same_title_near_the_start() {
    let weekly = event(
        "w",
        "Weekly de TI",
        "2026-10-31T10:00:00Z",
        "2026-10-31T10:45:00Z",
    );
    let sessions = json!([
        {"id": "recorded", "title": "Weekly de TI", "starts_at": "2026-10-31T10:00:00Z", "status": "planned", "meeting_id": "m"},
        {"id": "far", "title": "Weekly de TI", "starts_at": "2026-10-31T12:00:00Z", "status": "planned", "meeting_id": null},
        {"id": "done", "title": "weekly de ti", "starts_at": "2026-10-31T10:00:00Z", "status": "completed", "meeting_id": null},
        {"id": "hit", "title": " weekly de TI ", "starts_at": "2026-10-31T10:20:00Z", "status": "planned", "meeting_id": null}
    ]);
    assert_eq!(reusable_session(&sessions, &weekly).as_deref(), Some("hit"));
    assert_eq!(reusable_session(&json!([]), &weekly), None);
}

#[test]
fn invitees_are_deduplicated_and_session_times_are_normalized() {
    let weekly = event(
        "w",
        "Weekly",
        "2026-10-31T10:00:00.0000000Z",
        "2026-10-31T10:45:00Z",
    );
    let people: Vec<_> = invitees(&weekly).into_iter().map(|p| p.name).collect();
    assert_eq!(people, vec!["Rita Souza", "Marcos"]);
    assert_eq!(
        session_time(&weekly.starts_at).as_deref(),
        Some("2026-10-31T10:00:00Z")
    );
}

#[test]
fn picks_the_saved_device_then_the_system_default() {
    let sources = json!([
        {"name": "usb", "monitor": false, "is_default": false},
        {"name": "builtin", "monitor": false, "is_default": true},
        {"name": "speakers.monitor", "monitor": true, "is_default": true}
    ]);
    assert_eq!(
        pick_source(&sources, false, Some("usb")).as_deref(),
        Some("usb")
    );
    assert_eq!(
        pick_source(&sources, false, Some("gone")).as_deref(),
        Some("builtin")
    );
    assert_eq!(
        pick_source(&sources, false, None).as_deref(),
        Some("builtin")
    );
    assert_eq!(
        pick_source(&sources, true, None).as_deref(),
        Some("speakers.monitor")
    );
    assert_eq!(pick_source(&json!([]), true, None), None);
}
