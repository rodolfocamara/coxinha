use super::super::photo_graph::{classify, directory_url, member_id, photo_url};
use super::*;
use coxinha_core::store::Store;
use std::sync::Mutex;

const NOW: i64 = 1_800_000_000;
const WEEK: i64 = 7 * 24 * 60 * 60;
const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 1];
const INVITED: &str = "Participant in meetings from your calendar";
const USER: &str = "00000000-0000-4000-8000-0000000000aa";

struct StoreLedger(Mutex<Store>);

impl Ledger for StoreLedger {
    async fn record(&self, person: &str, now: i64, photo: Option<Vec<u8>>) -> Result<bool, String> {
        let store = self.0.lock().unwrap();
        store
            .photo_record(person, now, photo.as_deref())
            .map_err(|e| e.to_string())
    }
    async fn block(&self, code: &str) -> Result<(), String> {
        let store = self.0.lock().unwrap();
        store.photo_block(code).map_err(|e| e.to_string())
    }
    async fn pause(&self, until: i64) -> Result<(), String> {
        let store = self.0.lock().unwrap();
        store.photo_pause(until).map_err(|e| e.to_string())
    }
}

struct Scripted {
    lookup: fn() -> Reply<Option<String>>,
    photo: fn() -> Reply<Vec<u8>>,
    calls: Mutex<Vec<String>>,
}

impl Scripted {
    fn new(lookup: fn() -> Reply<Option<String>>, photo: fn() -> Reply<Vec<u8>>) -> Self {
        Self {
            lookup,
            photo,
            calls: Mutex::new(Vec::new()),
        }
    }
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

impl Directory for Scripted {
    async fn lookup(&self, mail: &str) -> Reply<Option<String>> {
        self.calls.lock().unwrap().push(format!("lookup {mail}"));
        (self.lookup)()
    }
    async fn photo(&self, id: &str) -> Reply<Vec<u8>> {
        self.calls.lock().unwrap().push(format!("photo {id}"));
        (self.photo)()
    }
}

fn found() -> Reply<Option<String>> {
    Reply::Found(Some(USER.to_string()))
}
fn jpeg() -> Reply<Vec<u8>> {
    Reply::Found(JPEG.to_vec())
}

struct Fixture {
    _dir: tempfile::TempDir,
    ledger: StoreLedger,
    person: String,
}

fn fixture(enabled: bool) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let person = store.create_person("Ana Souza", &[], INVITED).unwrap();
    if enabled {
        store.photo_enable().unwrap();
    }
    Fixture {
        _dir: dir,
        ledger: StoreLedger(Mutex::new(store)),
        person,
    }
}

impl Fixture {
    fn invitees() -> Vec<PhotoInvitee> {
        vec![PhotoInvitee {
            name: "Ana Souza".into(),
            mail: "ana@example.test".into(),
        }]
    }
    fn due(&self, now: i64) -> Vec<DuePhoto> {
        let store = self.ledger.0.lock().unwrap();
        store.photo_due(&Self::invitees(), now, PER_PASS).unwrap()
    }
    fn store<T>(&self, read: impl FnOnce(&Store) -> T) -> T {
        read(&self.ledger.0.lock().unwrap())
    }
    async fn pass(&self, directory: &Scripted, now: i64) -> usize {
        run(&self.ledger, directory, self.due(now), now)
            .await
            .unwrap()
    }
}

#[test]
fn only_the_explicit_opt_in_asks_for_the_scope() {
    assert!(!authorize_scope(false).contains("User.ReadBasic.All"));
    assert_eq!(authorize_scope(false), AUTHORIZE_SCOPE);
    assert!(!REFRESH_SCOPE.contains("User.ReadBasic.All"));
    let asked = authorize_scope(true);
    assert!(asked.starts_with(AUTHORIZE_SCOPE));
    assert!(asked.ends_with(" https://graph.microsoft.com/User.ReadBasic.All"));
}

#[test]
fn the_scope_is_read_from_the_token_response() {
    assert_eq!(scope_granted(None), None);
    assert_eq!(
        scope_granted(Some("Calendars.ReadBasic openid")),
        Some(false)
    );
    assert_eq!(
        scope_granted(Some(
            "openid https://graph.microsoft.com/User.ReadBasic.All"
        )),
        Some(true)
    );
    assert_eq!(scope_granted(Some("user.readbasic.all")), Some(true));
    assert_eq!(scope_granted(Some("User.ReadBasic.All.Extra")), Some(false));
}

#[test]
fn only_a_sign_in_that_asked_and_was_granted_turns_it_on() {
    let granted = Some("openid User.ReadBasic.All");
    let refused = Some("openid Calendars.ReadBasic");
    let enable = |action: Option<PhotoAction>| matches!(action, Some(PhotoAction::Enable));
    let blocked = |action: Option<PhotoAction>| matches!(action, Some(PhotoAction::Block(code)) if code == "calendar.photosConsent");
    assert!(sign_in_action(false, false, granted).is_none());
    assert!(sign_in_action(false, false, refused).is_none());
    assert!(enable(sign_in_action(true, false, granted)));
    assert!(blocked(sign_in_action(true, false, refused)));
    assert!(blocked(sign_in_action(true, false, None)));
    assert!(enable(sign_in_action(false, true, granted)));
    assert!(blocked(sign_in_action(false, true, refused)));
}

#[test]
fn request_urls_match_the_graph_documentation() {
    assert_eq!(
        photo_url(USER).unwrap().as_str(),
        format!("https://graph.microsoft.com/v1.0/users/{USER}/photos/240x240/$value")
    );
    assert!(photo_url("../me/messages").is_err());
    assert!(photo_url("someone@example.test").is_err());

    let url = directory_url("o'neil+a@example.test").unwrap();
    assert_eq!(url.host_str(), Some("graph.microsoft.com"));
    assert_eq!(url.path(), "/v1.0/users");
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["$filter"], "mail eq 'o''neil+a@example.test'");
    assert_eq!(query["$select"], "id,userPrincipalName");
}

#[test]
fn only_a_single_member_of_the_tenant_is_accepted() {
    let page = |value| serde_json::json!({ "value": value });
    let member = serde_json::json!({"id": USER, "userPrincipalName": "ana@example.test"});
    let guest =
        serde_json::json!({"id": USER, "userPrincipalName": "ana_x.test#EXT#@example.test"});
    assert_eq!(
        member_id(&page(serde_json::json!([member]))),
        Some(USER.to_string())
    );
    assert_eq!(member_id(&page(serde_json::json!([guest]))), None);
    assert_eq!(member_id(&page(serde_json::json!([]))), None);
    assert_eq!(member_id(&page(serde_json::json!([member, member]))), None);
}

#[test]
fn statuses_map_to_what_the_pass_does() {
    assert_eq!(classify::<()>(200, None), None);
    assert_eq!(classify::<()>(404, None), Some(Reply::NotFound));
    assert_eq!(classify::<()>(401, None), Some(Reply::Unauthorized));
    assert_eq!(classify::<()>(403, None), Some(Reply::Forbidden));
    assert_eq!(
        classify::<()>(429, Some(120)),
        Some(Reply::Later(Some(120)))
    );
    assert_eq!(classify::<()>(503, None), Some(Reply::Later(None)));
}

#[test]
fn invitees_skip_cancelled_events_and_people_without_mail() {
    let person = |name: &str, email: Option<&str>| Candidate {
        name: name.into(),
        email: email.map(str::to_string),
    };
    let event = |cancelled, organizer, attendees| Event {
        id: "e".into(),
        title: "t".into(),
        starts_at: "s".into(),
        ends_at: "e".into(),
        cancelled,
        all_day: false,
        attendees,
        organizer,
        series_master_id: None,
        event_type: None,
        original_start: None,
        categories: vec![],
        response: None,
        attendee_responses: vec![],
        location: None,
        join_url: None,
        body_preview: None,
        show_as: None,
        is_organizer: false,
        web_link: None,
    };
    let snapshot = Snapshot {
        events: vec![
            event(
                false,
                Some(person("Org", Some("org@example.test"))),
                vec![
                    person("Ana", Some("ana@example.test")),
                    person("No Mail", None),
                    person("Not A Mail", Some("nobody")),
                ],
            ),
            event(true, None, vec![person("Gone", Some("gone@example.test"))]),
        ],
        ..Snapshot::default()
    };
    let names: Vec<_> = invitees(&snapshot).into_iter().map(|i| i.name).collect();
    assert_eq!(names, ["Org", "Ana"]);
}

#[tokio::test]
async fn with_the_opt_in_off_no_request_is_made() {
    let f = fixture(false);
    let graph = Scripted::new(found, jpeg);
    assert!(f.due(NOW).is_empty());
    assert_eq!(f.pass(&graph, NOW).await, 0);
    assert!(graph.calls().is_empty());
}

#[tokio::test]
async fn a_photo_is_fetched_once_kept_and_refreshed_after_a_week() {
    let f = fixture(true);
    let graph = Scripted::new(found, jpeg);
    assert_eq!(f.pass(&graph, NOW).await, 1);
    assert_eq!(
        graph.calls(),
        [
            "lookup ana@example.test".to_string(),
            format!("photo {USER}")
        ]
    );
    assert_eq!(
        f.store(|s| s.photo_read(&f.person).unwrap()),
        Some(("image/jpeg".to_string(), JPEG.to_vec()))
    );
    assert_eq!(f.pass(&graph, NOW + WEEK - 1).await, 0);
    assert_eq!(graph.calls().len(), 2);
    assert_eq!(f.pass(&graph, NOW + WEEK).await, 1);
    assert_eq!(graph.calls().len(), 4);
}

#[tokio::test]
async fn a_404_is_remembered_for_the_week() {
    let f = fixture(true);
    let graph = Scripted::new(found, || Reply::NotFound);
    f.pass(&graph, NOW).await;
    assert_eq!(f.store(|s| s.photo_read(&f.person).unwrap()), None);
    f.pass(&graph, NOW + 60).await;
    f.pass(&graph, NOW + WEEK - 1).await;
    assert_eq!(graph.calls().len(), 2);
    f.pass(&graph, NOW + WEEK).await;
    assert_eq!(graph.calls().len(), 4);
}

#[tokio::test]
async fn a_mail_outside_the_tenant_never_reaches_the_photo_endpoint() {
    let f = fixture(true);
    let graph = Scripted::new(|| Reply::Found(None), jpeg);
    f.pass(&graph, NOW).await;
    f.pass(&graph, NOW + 60).await;
    assert_eq!(graph.calls(), ["lookup ana@example.test"]);
}

#[tokio::test]
async fn a_403_blocks_visibly_and_does_not_retry() {
    let f = fixture(true);
    let graph = Scripted::new(|| Reply::Forbidden, jpeg);
    f.pass(&graph, NOW).await;
    assert_eq!(
        f.store(|s| s.photo_status().unwrap().blocked),
        Some("calendar.photosForbidden".to_string())
    );
    f.pass(&graph, NOW + WEEK * 4).await;
    assert_eq!(graph.calls().len(), 1);
}

#[tokio::test]
async fn a_rejected_token_asks_to_reconnect_and_does_not_retry() {
    let f = fixture(true);
    let graph = Scripted::new(found, || Reply::Unauthorized);
    f.pass(&graph, NOW).await;
    assert_eq!(
        f.store(|s| s.photo_status().unwrap().blocked),
        Some("calendar.reconnect".to_string())
    );
    f.pass(&graph, NOW + WEEK * 4).await;
    assert_eq!(graph.calls().len(), 2);
}

#[tokio::test]
async fn an_outage_waits_at_least_an_hour_and_keeps_the_person_due() {
    let f = fixture(true);
    let graph = Scripted::new(|| Reply::Later(Some(5)), jpeg);
    f.pass(&graph, NOW).await;
    assert_eq!(graph.calls().len(), 1);
    assert!(f.due(NOW + MIN_PAUSE_SECONDS - 1).is_empty());
    assert_eq!(f.due(NOW + MIN_PAUSE_SECONDS).len(), 1);
    assert_eq!(f.store(|s| s.photo_status().unwrap().blocked), None);
}

#[tokio::test]
async fn retry_after_longer_than_the_hour_is_respected() {
    let f = fixture(true);
    let graph = Scripted::new(|| Reply::Later(Some(7200)), jpeg);
    f.pass(&graph, NOW).await;
    assert!(f.due(NOW + 7199).is_empty());
    assert_eq!(f.due(NOW + 7200).len(), 1);
}

#[tokio::test]
async fn an_opt_out_during_the_pass_keeps_nothing() {
    let f = fixture(true);
    let graph = Scripted::new(found, jpeg);
    let due = f.due(NOW);
    f.store(|s| s.photo_disable().unwrap());
    assert_eq!(run(&f.ledger, &graph, due, NOW).await.unwrap(), 0);
    assert_eq!(f.store(|s| s.photo_read(&f.person).unwrap()), None);
    assert_eq!(f.store(|s| s.photo_status().unwrap().stored), 0);
}
