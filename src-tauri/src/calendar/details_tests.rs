use super::*;
use serde_json::json;

fn item(extra: serde_json::Value) -> serde_json::Value {
    let mut base = json!({
        "id": "event-1", "subject": "Roadmap",
        "start": { "dateTime": "2026-11-03T12:00:00", "timeZone": "UTC" },
        "end": { "dateTime": "2026-11-03T13:00:00", "timeZone": "UTC" },
        "isCancelled": false, "isAllDay": false, "attendees": [],
    });
    for (key, value) in extra.as_object().unwrap() {
        base[key] = value.clone();
    }
    base
}

fn event(id: &str, web_link: Option<&str>) -> Event {
    let mut event = parse_event(&item(json!({ "id": id }))).unwrap();
    event.web_link = web_link.map(str::to_string);
    event
}

#[test]
fn reads_the_details_outlook_has() {
    let event = parse_event(&item(json!({
        "responseStatus": { "response": "tentativelyAccepted", "time": "2026-11-01T00:00:00Z" },
        "attendees": [
            { "type": "required", "status": { "response": "accepted" },
              "emailAddress": { "name": "Ana", "address": "ana@example.test" } },
            { "type": "optional", "status": { "response": "declined" },
              "emailAddress": { "name": " Bruno ", "address": "bruno@example.test" } },
            { "type": "resource", "status": { "response": "accepted" },
              "emailAddress": { "name": "Room 4", "address": "room@example.test" } },
        ],
        "location": { "displayName": " Room 4 " },
        "onlineMeeting": { "joinUrl": "https://teams.microsoft.com/l/meetup-join/abc" },
        "bodyPreview": " Agenda\r\nfirst point ",
        "showAs": "tentative",
        "isOrganizer": true,
        "webLink": "https://outlook.office365.com/owa/?itemid=abc&exvsurl=1&path=/calendar/item",
    })))
    .unwrap();
    assert!(event.response == Some(Response::TentativelyAccepted));
    assert!(event.show_as == Some(ShowAs::Tentative));
    assert!(event.is_organizer);
    assert_eq!(event.location.as_deref(), Some("Room 4"));
    assert_eq!(
        event.join_url.as_deref(),
        Some("https://teams.microsoft.com/l/meetup-join/abc")
    );
    assert_eq!(event.body_preview.as_deref(), Some("Agenda\nfirst point"));
    assert!(event.web_link.is_some());
    assert_eq!(event.attendees.len(), 3);
    let bruno = &event.attendee_responses[1];
    assert_eq!(bruno.name, "Bruno");
    assert!(bruno.response == Some(Response::Declined));
    assert!(bruno.kind == Some(AttendeeKind::Optional));
}

#[test]
fn missing_or_unknown_details_stay_empty() {
    let event = parse_event(&item(json!({
        "responseStatus": { "response": "somethingNew" },
        "attendees": [{ "emailAddress": { "name": "Ana" }, "status": 3, "type": "guest" }],
        "location": { "displayName": "   " },
        "onlineMeeting": null,
        "bodyPreview": "",
        "showAs": 7,
        "webLink": "https://evil.example/calendar",
    })))
    .unwrap();
    assert!(event.response.is_none());
    assert!(event.show_as.is_none());
    assert!(!event.is_organizer);
    assert!(event.location.is_none());
    assert!(event.join_url.is_none());
    assert!(event.body_preview.is_none());
    assert!(event.web_link.is_none());
    assert!(event.attendee_responses[0].response.is_none());
    assert!(event.attendee_responses[0].kind.is_none());
}

#[test]
fn the_preview_is_capped_and_loses_control_characters() {
    let long = "x".repeat(2 * MAX_PREVIEW);
    let event = parse_event(&item(json!({ "bodyPreview": long }))).unwrap();
    assert_eq!(event.body_preview.unwrap().chars().count(), MAX_PREVIEW);
    let event = parse_event(&item(json!({ "bodyPreview": "a\u{1b}[31mb\u{0}" }))).unwrap();
    assert_eq!(event.body_preview.as_deref(), Some("a[31mb"));
}

#[test]
fn a_cache_from_before_this_spec_still_loads() {
    let snapshot: Snapshot = serde_json::from_value(json!({
        "account": "me", "syncedAt": null,
        "events": [{
            "id": "e", "title": "Old", "startsAt": "2026-11-03T12:00:00Z",
            "endsAt": "2026-11-03T13:00:00Z", "cancelled": false, "allDay": false,
            "attendees": [{ "name": "Ana", "email": null }],
        }],
    }))
    .unwrap();
    let event = &snapshot.events[0];
    assert!(event.attendee_responses.is_empty());
    assert!(event.response.is_none() && event.join_url.is_none() && !event.is_organizer);
}

#[test]
fn only_teams_urls_over_https_are_accepted() {
    for good in [
        "https://teams.microsoft.com/l/meetup-join/19%3ameeting/0?context=%7b%7d",
        "https://teams.live.com/meet/9876",
        "https://teams.cloud.microsoft/meet/123",
    ] {
        assert_eq!(join_url(Some(good)).as_deref(), Some(good));
    }
    for bad in [
        "http://teams.microsoft.com/l/meetup-join/abc",
        "https://teams.microsoft.com.evil.example/l/meetup-join/abc",
        "https://evil.example/teams.microsoft.com",
        "https://teams.microsoft.com@evil.example/x",
        "https://user:pw@teams.microsoft.com/x",
        "https://teams.microsoft.com:8443/x",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "ms-teams:/l/meetup-join/abc",
        "not a url",
        "",
    ] {
        assert_eq!(join_url(Some(bad)), None, "{bad}");
    }
    assert_eq!(join_url(None), None);
    let long = format!("https://teams.microsoft.com/{}", "x".repeat(MAX_URL));
    assert_eq!(join_url(Some(&long)), None);
}

#[test]
fn outlook_link_uses_the_current_format() {
    assert_eq!(
        outlook_url(&event("AA+b/c=", None)),
        "https://outlook.office365.com/calendar/item/AA%2Bb%2Fc%3D"
    );
    assert_eq!(
        outlook_url(&event(
            "AAM-k_1",
            Some("https://outlook.office365.com/owa/?itemid=x")
        )),
        "https://outlook.office365.com/calendar/item/AAM-k_1"
    );
    assert_eq!(
        outlook_url(&event("id", Some("https://outlook.live.com/owa/?itemid=x"))),
        "https://outlook.live.com/calendar/item/id"
    );
}

#[test]
fn opening_checks_the_cached_url_again() {
    let mut cached = event("e", None);
    cached.join_url = Some("https://evil.example/join".into());
    assert_eq!(target(&cached, EventLink::Join), None);
    cached.join_url = Some("https://teams.microsoft.com/l/x".into());
    assert_eq!(
        target(&cached, EventLink::Join).as_deref(),
        Some("https://teams.microsoft.com/l/x")
    );
    assert!(target(&cached, EventLink::Outlook).is_some());
}
