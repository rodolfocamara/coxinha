use super::*;
use serde_json::json;

const NOW: &str = "2026-11-04T12:00:00Z";

pub(super) fn now() -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(NOW)
        .unwrap()
        .with_timezone(&Utc)
}

pub(super) fn invite(id: &str) -> Event {
    parse_event(&json!({
        "id": id,
        "subject": "Project Atlas",
        "start": {"dateTime": "2026-11-05T16:30:00.0000000", "timeZone": "UTC"},
        "end": {"dateTime": "2026-11-05T17:00:00.0000000", "timeZone": "UTC"},
        "isCancelled": false,
        "isAllDay": false,
        "isOrganizer": false,
        "allowNewTimeProposals": true,
        "responseRequested": true,
        "responseStatus": {"response": "notResponded"},
        "showAs": "tentative",
        "attendees": [{"emailAddress": {"name": "Owner", "address": "o@example.test"}}],
        "organizer": {"emailAddress": {"name": "Host", "address": "h@example.test"}},
    }))
    .unwrap()
}

pub(super) fn occurrence(id: &str, master: &str) -> Event {
    Event {
        series_master_id: Some(master.into()),
        event_type: Some("occurrence".into()),
        ..invite(id)
    }
}

pub(super) fn request(kind: ResponseKind, scope: ResponseScope) -> ResponseRequest {
    ResponseRequest {
        kind,
        scope,
        comment: None,
        notify: true,
        proposed: None,
    }
}

pub(super) fn slot() -> ProposedSlot {
    ProposedSlot {
        starts_at: "2026-11-06T14:00:00-03:00".into(),
        ends_at: "2026-11-06T15:00:00-03:00".into(),
    }
}

#[test]
fn each_kind_posts_to_its_own_action_on_an_occurrence_and_on_a_series() {
    let event = occurrence("occ-1", "master-1");
    let cases = [
        (ResponseKind::Accept, "accept"),
        (ResponseKind::Tentative, "tentativelyAccept"),
        (ResponseKind::Decline, "decline"),
    ];
    for (kind, action) in cases {
        let one = prepare(&event, &request(kind, ResponseScope::Occurrence), now()).unwrap();
        assert_eq!(
            reply_url(&one).unwrap().as_str(),
            format!("https://graph.microsoft.com/v1.0/me/events/occ-1/{action}")
        );
        assert_eq!(one.body, json!({"sendResponse": true}));
        let all = prepare(&event, &request(kind, ResponseScope::Series), now()).unwrap();
        assert_eq!(
            reply_url(&all).unwrap().as_str(),
            format!("https://graph.microsoft.com/v1.0/me/events/master-1/{action}")
        );
        assert_eq!(all.body, json!({"sendResponse": true}));
    }
}

#[test]
fn an_event_id_cannot_escape_its_path_segment() {
    let reply = prepare(
        &invite("a/b?c=d#e"),
        &request(ResponseKind::Accept, ResponseScope::Occurrence),
        now(),
    )
    .unwrap();
    assert_eq!(
        reply_url(&reply).unwrap().as_str(),
        "https://graph.microsoft.com/v1.0/me/events/a%2Fb%3Fc=d%23e/accept"
    );
}

#[test]
fn a_comment_goes_with_a_notified_response_and_is_dropped_when_silent() {
    let mut asked = request(ResponseKind::Decline, ResponseScope::Occurrence);
    asked.comment = Some("  On leave that week.  ".into());
    assert_eq!(
        prepare(&invite("e"), &asked, now()).unwrap().body,
        json!({"sendResponse": true, "comment": "On leave that week."})
    );
    asked.notify = false;
    assert_eq!(
        prepare(&invite("e"), &asked, now()).unwrap().body,
        json!({"sendResponse": false})
    );
    asked.notify = true;
    asked.comment = Some("   ".into());
    assert_eq!(
        prepare(&invite("e"), &asked, now()).unwrap().body,
        json!({"sendResponse": true})
    );
}

#[test]
fn a_proposal_is_sent_in_utc_with_tentative_or_decline() {
    for (kind, action) in [
        (ResponseKind::Tentative, "tentativelyAccept"),
        (ResponseKind::Decline, "decline"),
    ] {
        let mut asked = request(kind, ResponseScope::Occurrence);
        asked.comment = Some("Friday instead?".into());
        asked.proposed = Some(slot());
        let reply = prepare(&invite("e"), &asked, now()).unwrap();
        assert_eq!(
            reply_url(&reply).unwrap().as_str(),
            format!("https://graph.microsoft.com/v1.0/me/events/e/{action}")
        );
        assert_eq!(
            reply.body,
            json!({
                "sendResponse": true,
                "comment": "Friday instead?",
                "proposedNewTime": {
                    "start": {"dateTime": "2026-11-06T17:00:00", "timeZone": "UTC"},
                    "end": {"dateTime": "2026-11-06T18:00:00", "timeZone": "UTC"},
                },
            })
        );
    }
}

#[test]
fn a_proposal_out_of_what_graph_allows_never_reaches_a_request() {
    let propose = |edit: &dyn Fn(&mut ResponseRequest), event: &Event| {
        let mut asked = request(ResponseKind::Tentative, ResponseScope::Occurrence);
        asked.proposed = Some(slot());
        edit(&mut asked);
        prepare(event, &asked, now()).err()
    };
    let e = occurrence("occ", "master");
    let invalid = Some(INVALID.to_string());
    assert_eq!(
        propose(&|a| a.kind = ResponseKind::Accept, &e),
        invalid,
        "accept"
    );
    assert_eq!(
        propose(&|a| a.scope = ResponseScope::Series, &e),
        invalid,
        "series"
    );
    assert_eq!(propose(&|a| a.notify = false, &e), invalid, "silent");
    let forbidden = Event {
        allow_new_time_proposals: Some(false),
        ..e.clone()
    };
    assert_eq!(
        propose(&|_| (), &forbidden),
        Some("calendar.respondNoProposals".to_string())
    );
    assert_eq!(propose(&|_| (), &e), None);
}

#[test]
fn a_bad_slot_or_a_long_comment_is_refused() {
    let at = |from: &str, to: &str| {
        let mut asked = request(ResponseKind::Tentative, ResponseScope::Occurrence);
        asked.proposed = Some(ProposedSlot {
            starts_at: from.into(),
            ends_at: to.into(),
        });
        prepare(&invite("e"), &asked, now()).err()
    };
    let invalid = Some(INVALID.to_string());
    let start = "2026-11-06T14:00:00Z";
    assert_eq!(at(start, start), invalid, "empty");
    assert_eq!(at("2026-11-06T15:00:00Z", start), invalid, "reversed");
    assert_eq!(at(start, "2026-11-30T14:00:00Z"), invalid, "too long");
    assert_eq!(at("2026-11-04T11:00:00Z", start), invalid, "past");
    assert_eq!(at("tomorrow", start), invalid, "unparsed");
    let mut asked = request(ResponseKind::Accept, ResponseScope::Occurrence);
    asked.comment = Some("x".repeat(MAX_COMMENT + 1));
    assert_eq!(prepare(&invite("e"), &asked, now()).err(), invalid);
    asked.comment = Some("é".repeat(MAX_COMMENT));
    assert!(prepare(&invite("e"), &asked, now()).is_ok());
}

#[test]
fn only_an_invitee_of_a_live_event_can_respond() {
    let unavailable = Some(UNAVAILABLE.to_string());
    let accept = request(ResponseKind::Accept, ResponseScope::Occurrence);
    let cases = [
        (
            "organizer",
            Event {
                is_organizer: true,
                ..invite("e")
            },
        ),
        (
            "organizer response",
            Event {
                response: Some(Response::Organizer),
                ..invite("e")
            },
        ),
        (
            "cancelled",
            Event {
                cancelled: true,
                ..invite("e")
            },
        ),
        (
            "personal block",
            Event {
                attendees: vec![],
                ..invite("e")
            },
        ),
        (
            "no organizer",
            Event {
                organizer: None,
                ..invite("e")
            },
        ),
        (
            "older cache",
            Event {
                response: None,
                ..invite("e")
            },
        ),
    ];
    for (name, event) in cases {
        assert_eq!(prepare(&event, &accept, now()).err(), unavailable, "{name}");
    }
    for response in [
        Response::None,
        Response::NotResponded,
        Response::Accepted,
        Response::TentativelyAccepted,
        Response::Declined,
    ] {
        let event = Event {
            response: Some(response),
            ..invite("e")
        };
        assert!(prepare(&event, &accept, now()).is_ok());
    }
    assert_eq!(
        prepare(
            &invite("single"),
            &request(ResponseKind::Accept, ResponseScope::Series),
            now()
        )
        .err(),
        unavailable,
        "a series needs its master"
    );
}

#[test]
fn the_window_sends_camel_case_and_a_missing_comment_is_fine() {
    let asked: ResponseRequest = serde_json::from_value(json!({
        "kind": "tentative",
        "scope": "series",
        "notify": false,
    }))
    .unwrap();
    assert_eq!(asked.kind, ResponseKind::Tentative);
    assert_eq!(asked.scope, ResponseScope::Series);
    assert!(asked.comment.is_none() && asked.proposed.is_none());
    let proposed: ProposedSlot = serde_json::from_value(json!({
        "startsAt": "2026-11-06T17:00:00Z",
        "endsAt": "2026-11-06T18:00:00Z",
    }))
    .unwrap();
    assert_eq!(proposed.starts_at, "2026-11-06T17:00:00Z");
}
