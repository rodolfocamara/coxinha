//! Spec 0124 P1: what Outlook knows about an event beyond its time and title.
//! Every field is optional here: a surprise from Graph never fails the sync.
use super::*;

const TEAMS_HOSTS: [&str; 3] = [
    "teams.microsoft.com",
    "teams.live.com",
    "teams.cloud.microsoft",
];
const OUTLOOK_HOSTS: [&str; 3] = [
    "outlook.office365.com",
    "outlook.office.com",
    "outlook.live.com",
];
const MAX_PREVIEW: usize = 500;
const MAX_LOCATION: usize = 200;
const MAX_URL: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Response {
    None,
    Organizer,
    TentativelyAccepted,
    Accepted,
    Declined,
    NotResponded,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ShowAs {
    Free,
    Tentative,
    Busy,
    Oof,
    WorkingElsewhere,
    Unknown,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AttendeeKind {
    Required,
    Optional,
    Resource,
}

/// Apart from `attendees`, which is what participants and the CLI read: a
/// response must never end up stored as a meeting's participant.
#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AttendeeResponse {
    pub name: String,
    pub email: Option<String>,
    pub response: Option<Response>,
    pub kind: Option<AttendeeKind>,
}

#[derive(Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum EventLink {
    Join,
    Outlook,
}

fn known<T: serde::de::DeserializeOwned>(value: &serde_json::Value) -> Option<T> {
    serde_json::from_value(value.clone()).ok()
}

pub(super) fn response_of(item: &serde_json::Value) -> Option<Response> {
    known(&item["responseStatus"]["response"])
}

pub(super) fn show_as_of(item: &serde_json::Value) -> Option<ShowAs> {
    known(&item["showAs"])
}

pub(super) fn attendee_responses(item: &serde_json::Value) -> Vec<AttendeeResponse> {
    item["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| {
            let address = &a["emailAddress"];
            let name = address["name"].as_str()?.trim();
            (!name.is_empty()).then(|| AttendeeResponse {
                name: name.into(),
                email: address["address"].as_str().map(str::to_string),
                response: known(&a["status"]["response"]),
                kind: known(&a["type"]),
            })
        })
        .collect()
}

/// Plain text only: control characters go, and the UI never renders it as HTML.
fn clean(raw: Option<&str>, limit: usize) -> Option<String> {
    let text: String = raw?
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(limit)
        .collect();
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

pub(super) fn body_preview(item: &serde_json::Value) -> Option<String> {
    clean(item["bodyPreview"].as_str(), MAX_PREVIEW)
}

pub(super) fn location(item: &serde_json::Value) -> Option<String> {
    clean(item["location"]["displayName"].as_str(), MAX_LOCATION)
}

fn https_on(raw: &str, hosts: &[&str]) -> Option<reqwest::Url> {
    if raw.len() > MAX_URL {
        return None;
    }
    let url = reqwest::Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && hosts.contains(&url.host_str()?))
    .then_some(url)
}

/// The URL comes from whoever wrote the invite, so it is untrusted.
pub(super) fn join_url(raw: Option<&str>) -> Option<String> {
    https_on(raw?, &TEAMS_HOSTS).map(String::from)
}

pub(super) fn web_link(raw: Option<&str>) -> Option<String> {
    https_on(raw?, &OUTLOOK_HOSTS).map(String::from)
}

fn encoded(id: &str) -> String {
    id.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Graph's `webLink` only opens earlier versions of Outlook on the web; its
/// docs give this form for the current one. `webLink` still tells a personal
/// account from a work one.
pub(super) fn outlook_url(event: &Event) -> String {
    let personal = event
        .web_link
        .as_deref()
        .and_then(|raw| https_on(raw, &OUTLOOK_HOSTS))
        .is_some_and(|url| url.host_str() == Some("outlook.live.com"));
    let host = if personal {
        "outlook.live.com"
    } else {
        "outlook.office365.com"
    };
    format!("https://{host}/calendar/item/{}", encoded(&event.id))
}

fn target(event: &Event, link: EventLink) -> Option<String> {
    match link {
        EventLink::Join => join_url(event.join_url.as_deref()),
        EventLink::Outlook => Some(outlook_url(event)),
    }
}

/// The window names the event, never a URL; the cached one is checked again here.
#[tauri::command]
#[specta::specta]
pub async fn calendar_open_link(
    app: tauri::AppHandle,
    event_id: String,
    link: EventLink,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = calendar_status(app.clone())?
        .events
        .iter()
        .find(|e| e.id == event_id)
        .and_then(|e| target(e, link))
        .ok_or("calendar.linkUnavailable")?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "calendar.linkFailed".into())
}

#[cfg(test)]
#[path = "details_tests.rs"]
mod tests;
