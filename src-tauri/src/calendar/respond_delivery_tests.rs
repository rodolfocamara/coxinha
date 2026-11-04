use super::tests::{invite, now, occurrence, request, slot};
use super::*;
use serde_json::json;
use std::io::BufRead;

#[test]
fn statuses_map_to_what_the_owner_can_do() {
    assert_eq!(status_outcome(202), Ok(()));
    let code = |status| status_outcome(status).unwrap_err();
    assert_eq!(code(400), "calendar.respondRejected");
    assert_eq!(code(401), RECONNECT);
    assert_eq!(code(403), RECONNECT);
    assert_eq!(code(404), "calendar.eventMissing");
    for status in [302, 409, 429, 500, 503] {
        assert_eq!(code(status), "calendar.respondFailed", "{status}");
    }
    assert_eq!(transport_error(false), "calendar.respondOffline");
    assert_eq!(transport_error(true), "calendar.respondUncertain");
}

/// A local server standing in for Graph: answers one request with `status`.
fn local_server(status: &'static str) -> (u16, std::thread::JoinHandle<(Vec<String>, String)>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = std::io::BufReader::new(stream);
        let mut head = Vec::new();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line.trim().is_empty() {
                break;
            }
            head.push(line.trim().to_string());
        }
        let length = head
            .iter()
            .find_map(|l| {
                l.to_ascii_lowercase()
                    .strip_prefix("content-length: ")?
                    .parse()
                    .ok()
            })
            .unwrap_or(0usize);
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        reader
            .get_mut()
            .write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\n\r\n").as_bytes())
            .unwrap();
        (head, String::from_utf8(body).unwrap())
    });
    (port, handle)
}

fn on_port(reply: &Reply, port: u16) -> reqwest::Url {
    let mut url = reply_url(reply).unwrap();
    url.set_scheme("http").unwrap();
    url.set_host(Some("127.0.0.1")).unwrap();
    url.set_port(Some(port)).unwrap();
    url
}

#[tokio::test]
async fn the_post_on_the_wire_has_the_token_the_id_preference_and_the_body() {
    let (port, server) = local_server("202 Accepted");
    let mut asked = request(ResponseKind::Tentative, ResponseScope::Series);
    asked.comment = Some("Maybe.".into());
    let reply = prepare(&occurrence("occ", "master"), &asked, now()).unwrap();
    deliver(
        &client().unwrap(),
        on_port(&reply, port),
        "token",
        &reply.body,
    )
    .await
    .unwrap();
    let (head, body) = server.join().unwrap();
    assert_eq!(
        head[0],
        "POST /v1.0/me/events/master/tentativelyAccept HTTP/1.1"
    );
    let has = |wanted: &str| head.iter().any(|l| l.eq_ignore_ascii_case(wanted));
    assert!(has("authorization: Bearer token"));
    assert!(has("prefer: IdType=\"ImmutableId\""));
    assert!(has("content-type: application/json"));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap(),
        json!({"sendResponse": true, "comment": "Maybe."})
    );
}

#[tokio::test]
async fn a_refusal_on_the_wire_is_an_error_and_a_closed_port_says_nothing_was_sent() {
    let reply = prepare(
        &invite("e"),
        &request(ResponseKind::Accept, ResponseScope::Occurrence),
        now(),
    )
    .unwrap();
    let http = client().unwrap();
    let (port, server) = local_server("403 Forbidden");
    let refused = deliver(&http, on_port(&reply, port), "t", &reply.body).await;
    assert_eq!(refused, Err(RECONNECT.to_string()));
    server.join().unwrap();
    let closed = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let offline = deliver(&http, on_port(&reply, port), "t", &reply.body).await;
    assert_eq!(offline, Err("calendar.respondOffline".to_string()));
}

fn answers(snapshot: &Snapshot) -> Vec<(&str, Option<Response>)> {
    snapshot
        .events
        .iter()
        .map(|e| (e.id.as_str(), e.response))
        .collect()
}

#[test]
fn the_cache_changes_for_one_occurrence_or_for_the_whole_series() {
    let snapshot = || Snapshot {
        events: vec![
            occurrence("occ-1", "master"),
            occurrence("occ-2", "master"),
            occurrence("other", "another"),
            invite("single"),
        ],
        ..Snapshot::default()
    };
    let waiting = Some(Response::NotResponded);
    let mut one = snapshot();
    let reply = prepare(
        &one.events[1],
        &request(ResponseKind::Decline, ResponseScope::Occurrence),
        now(),
    )
    .unwrap();
    apply_response(&mut one, &reply);
    assert_eq!(
        answers(&one),
        [
            ("occ-1", waiting),
            ("occ-2", Some(Response::Declined)),
            ("other", waiting),
            ("single", waiting),
        ]
    );
    let mut all = snapshot();
    let reply = prepare(
        &all.events[0],
        &request(ResponseKind::Accept, ResponseScope::Series),
        now(),
    )
    .unwrap();
    apply_response(&mut all, &reply);
    assert_eq!(
        answers(&all),
        [
            ("occ-1", Some(Response::Accepted)),
            ("occ-2", Some(Response::Accepted)),
            ("other", waiting),
            ("single", waiting),
        ]
    );
}

#[test]
fn the_block_follows_the_answer_and_a_cancelled_occurrence_stays_as_it_was() {
    let cases = [
        (ResponseKind::Accept, ShowAs::Tentative, ShowAs::Busy),
        (ResponseKind::Accept, ShowAs::Free, ShowAs::Free),
        (ResponseKind::Tentative, ShowAs::Busy, ShowAs::Tentative),
        (ResponseKind::Decline, ShowAs::Busy, ShowAs::Busy),
    ];
    for (kind, before, after) in cases {
        let event = Event {
            show_as: Some(before),
            ..invite("e")
        };
        let reply = prepare(&event, &request(kind, ResponseScope::Occurrence), now()).unwrap();
        let mut snapshot = Snapshot {
            events: vec![event],
            ..Snapshot::default()
        };
        apply_response(&mut snapshot, &reply);
        assert!(snapshot.events[0].show_as == Some(after), "{kind:?}");
    }
    let live = occurrence("live", "master");
    let reply = prepare(
        &live,
        &request(ResponseKind::Accept, ResponseScope::Series),
        now(),
    )
    .unwrap();
    let mut snapshot = Snapshot {
        events: vec![
            live,
            Event {
                cancelled: true,
                ..occurrence("gone", "master")
            },
        ],
        ..Snapshot::default()
    };
    apply_response(&mut snapshot, &reply);
    assert_eq!(
        answers(&snapshot),
        [
            ("live", Some(Response::Accepted)),
            ("gone", Some(Response::NotResponded)),
        ]
    );
}

#[test]
fn the_answer_survives_a_cache_round_trip_and_an_older_cache_loads() {
    let mut snapshot = Snapshot {
        events: vec![invite("e")],
        ..Snapshot::default()
    };
    let reply = prepare(
        &snapshot.events[0],
        &request(ResponseKind::Tentative, ResponseScope::Occurrence),
        now(),
    )
    .unwrap();
    apply_response(&mut snapshot, &reply);
    let bytes = serde_json::to_vec(&snapshot).unwrap();
    let back: Snapshot = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(answers(&back), [("e", Some(Response::TentativelyAccepted))]);
    assert_eq!(back.events[0].allow_new_time_proposals, Some(true));

    let mut raw = serde_json::to_value(&back).unwrap();
    let event = raw["events"][0].as_object_mut().unwrap();
    event.remove("allowNewTimeProposals");
    event.remove("responseRequested");
    let older: Snapshot = serde_json::from_value(raw).unwrap();
    assert_eq!(older.events[0].allow_new_time_proposals, None);
    assert_eq!(older.events[0].response_requested, None);
    assert!(prepare(
        &older.events[0],
        &ResponseRequest {
            proposed: Some(slot()),
            ..request(ResponseKind::Decline, ResponseScope::Occurrence)
        },
        now()
    )
    .is_ok());
}
