use super::*;
use serde_json::json;

const ID: &str = "0b9c3f0e-7a51-4c1e-9d55-2f1f3a4b5c6d";

fn event() -> NewEvent {
    validate(
        " Pulso MX ",
        "2026-11-04T16:30:00Z",
        "2026-11-04T17:00:00Z",
        ID,
    )
    .unwrap()
}

#[test]
fn body_sends_utc_times_and_invites_nobody() {
    assert_eq!(
        create_body(&event()),
        json!({
            "subject": "Pulso MX",
            "start": {"dateTime": "2026-11-04T16:30:00", "timeZone": "UTC"},
            "end": {"dateTime": "2026-11-04T17:00:00", "timeZone": "UTC"},
            "showAs": "busy",
            "attendees": [],
            "transactionId": ID,
        })
    );
}

#[test]
fn local_offsets_become_utc() {
    let local = validate(
        "x",
        "2026-11-04T13:30:00-03:00",
        "2026-11-04T14:00:00-03:00",
        ID,
    )
    .unwrap();
    assert_eq!(local.start, event().start);
    assert_eq!(local.end, event().end);
}

#[test]
fn posts_to_the_default_calendar() {
    assert_eq!(
        create_url().as_str(),
        "https://graph.microsoft.com/v1.0/me/events"
    );
}

#[test]
fn rejects_empty_or_long_subjects_bad_ranges_and_odd_transaction_ids() {
    let start = "2026-11-04T16:30:00Z";
    let end = "2026-11-04T17:00:00Z";
    let long = "x".repeat(256);
    let cases = [
        ("  ", start, end, ID),
        (long.as_str(), start, end, ID),
        ("x", end, start, ID),
        ("x", start, start, ID),
        ("x", start, "2026-11-30T00:00:00Z", ID),
        ("x", "yesterday", end, ID),
        ("x", start, end, ""),
        ("x", start, end, "a/b"),
    ];
    for (subject, from, to, transaction) in cases {
        assert_eq!(
            validate(subject, from, to, transaction),
            Err("calendar.createInvalid".into()),
            "{subject:?} {from} {to} {transaction:?}"
        );
    }
}

fn created(id: &str, start: &str) -> serde_json::Value {
    json!({
        "id": id,
        "subject": "Pulso MX",
        "start": {"dateTime": start, "timeZone": "UTC"},
        "end": {"dateTime": "2026-11-04T17:00:00.0000000", "timeZone": "UTC"},
        "isCancelled": false,
        "isAllDay": false,
        "attendees": [],
        "organizer": {"emailAddress": {"name": "Owner", "address": "o@example.com"}},
        "categories": [],
    })
}

#[test]
fn a_403_is_missing_write_access_and_other_failures_are_errors() {
    assert!(matches!(posted(403, None), Ok(Posted::Forbidden)));
    for status in [400, 401, 404, 409, 500] {
        assert_eq!(posted(status, None).err(), Some(SAFE_ERROR.to_string()));
    }
    let body = created("new", "2026-11-04T16:30:00.0000000");
    match posted(201, Some(&body)) {
        Ok(Posted::Created(Some(event))) => {
            assert_eq!(event.id, "new");
            assert_eq!(event.starts_at, "2026-11-04T16:30:00Z");
        }
        _ => panic!("created event not parsed"),
    }
    assert!(matches!(
        posted(201, Some(&json!({"id": 1}))),
        Ok(Posted::Created(None))
    ));
}

#[test]
fn the_created_event_is_added_once_in_start_order() {
    let early = parse_event(&created("early", "2026-11-04T09:00:00.0000000")).unwrap();
    let new = parse_event(&created("new", "2026-11-04T16:30:00.0000000")).unwrap();
    let mut snapshot = Snapshot {
        events: vec![early],
        ..Snapshot::default()
    };
    insert_created(&mut snapshot, Some(new.clone()));
    insert_created(&mut snapshot, Some(new));
    insert_created(&mut snapshot, None);
    let ids: Vec<_> = snapshot.events.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, ["early", "new"]);
}
