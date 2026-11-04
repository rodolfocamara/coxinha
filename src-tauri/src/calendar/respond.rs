//! Answering an invitation (spec 0130). A response reaches the organizer and
//! cannot be recalled: every refusal happens before the request, and nothing
//! here retries or queues on its own.
use super::*;

const MAX_COMMENT: usize = 2000;
const MAX_SLOT_DAYS: i64 = 14;
const INVALID: &str = "calendar.respondInvalid";
const UNAVAILABLE: &str = "calendar.respondUnavailable";
const RECONNECT: &str = "calendar.respondReconnect";

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ResponseKind {
    Accept,
    Tentative,
    Decline,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ResponseScope {
    Occurrence,
    Series,
}

#[derive(Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProposedSlot {
    pub starts_at: String,
    pub ends_at: String,
}

#[derive(Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResponseRequest {
    pub kind: ResponseKind,
    pub scope: ResponseScope,
    #[serde(default)]
    pub comment: Option<String>,
    pub notify: bool,
    #[serde(default)]
    pub proposed: Option<ProposedSlot>,
}

/// What goes out, built only from the cached event and a checked request.
#[derive(Debug, PartialEq)]
pub(super) struct Reply {
    pub target: String,
    pub kind: ResponseKind,
    pub scope: ResponseScope,
    pub body: serde_json::Value,
}

fn is_invitee(event: &Event) -> bool {
    !event.cancelled
        && !event.is_organizer
        && !event.attendees.is_empty()
        && event.organizer.is_some()
        && matches!(
            event.response,
            Some(
                Response::None
                    | Response::NotResponded
                    | Response::Accepted
                    | Response::TentativelyAccepted
                    | Response::Declined
            )
        )
}

fn instant(raw: &str) -> Result<chrono::DateTime<Utc>, String> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|_| INVALID.to_string())
}

/// Graph answers 400 to a proposal that is silent or on an event that forbids
/// it; a slot names one date, so it is not offered across a series either.
fn proposal(
    event: &Event,
    request: &ResponseRequest,
    slot: &ProposedSlot,
    now: chrono::DateTime<Utc>,
) -> Result<serde_json::Value, String> {
    if event.allow_new_time_proposals == Some(false) {
        return Err("calendar.respondNoProposals".into());
    }
    if request.kind == ResponseKind::Accept
        || request.scope == ResponseScope::Series
        || !request.notify
    {
        return Err(INVALID.into());
    }
    let start = instant(&slot.starts_at)?;
    let end = instant(&slot.ends_at)?;
    if end <= start || end - start > Duration::days(MAX_SLOT_DAYS) || start <= now {
        return Err(INVALID.into());
    }
    Ok(serde_json::json!({
        "start": create::utc_time(&start),
        "end": create::utc_time(&end),
    }))
}

pub(super) fn prepare(
    event: &Event,
    request: &ResponseRequest,
    now: chrono::DateTime<Utc>,
) -> Result<Reply, String> {
    if !is_invitee(event) {
        return Err(UNAVAILABLE.into());
    }
    let target = match request.scope {
        ResponseScope::Occurrence => event.id.clone(),
        ResponseScope::Series => event.series_master_id.clone().ok_or(UNAVAILABLE)?,
    };
    let mut body = serde_json::Map::new();
    body.insert("sendResponse".into(), request.notify.into());
    let comment = request.comment.as_deref().map(str::trim).unwrap_or("");
    if comment.chars().count() > MAX_COMMENT {
        return Err(INVALID.into());
    }
    // A silent response reaches nobody, so its comment would be lost text.
    if request.notify && !comment.is_empty() {
        body.insert("comment".into(), comment.into());
    }
    if let Some(slot) = &request.proposed {
        body.insert(
            "proposedNewTime".into(),
            proposal(event, request, slot, now)?,
        );
    }
    Ok(Reply {
        target,
        kind: request.kind,
        scope: request.scope,
        body: body.into(),
    })
}

pub(super) fn reply_url(reply: &Reply) -> Result<reqwest::Url, String> {
    let mut url = event_url(&reply.target)?;
    url.path_segments_mut()
        .map_err(|_| SAFE_ERROR)?
        .push(match reply.kind {
            ResponseKind::Accept => "accept",
            ResponseKind::Tentative => "tentativelyAccept",
            ResponseKind::Decline => "decline",
        });
    Ok(url)
}

/// `connected` is false when no connection was made, so nothing can have arrived.
pub(super) fn transport_error(connected: bool) -> String {
    if connected {
        "calendar.respondUncertain".into()
    } else {
        "calendar.respondOffline".into()
    }
}

pub(super) fn status_outcome(status: u16) -> Result<(), String> {
    match status {
        200..=299 => Ok(()),
        400 => Err("calendar.respondRejected".into()),
        401 | 403 => Err(RECONNECT.into()),
        404 => Err("calendar.eventMissing".into()),
        _ => Err("calendar.respondFailed".into()),
    }
}

pub(super) async fn deliver(
    http: &reqwest::Client,
    url: reqwest::Url,
    access: &str,
    body: &serde_json::Value,
) -> Result<(), String> {
    let response = http
        .post(url)
        .bearer_auth(access)
        // Cached IDs are immutable IDs (see `fetch`), and the header is per request.
        .header("Prefer", "IdType=\"ImmutableId\"")
        .json(body)
        .send()
        .await
        .map_err(|error| transport_error(!error.is_connect()))?;
    status_outcome(response.status().as_u16())
}

/// The owner's answer, on the event or on every cached event of its series. The
/// next refresh corrects whatever Exchange treated differently (spec 0130 P5).
pub(super) fn apply_response(snapshot: &mut Snapshot, reply: &Reply) {
    let answer = match reply.kind {
        ResponseKind::Accept => Response::Accepted,
        ResponseKind::Tentative => Response::TentativelyAccepted,
        ResponseKind::Decline => Response::Declined,
    };
    for event in &mut snapshot.events {
        let hit = match reply.scope {
            ResponseScope::Occurrence => event.id == reply.target,
            ResponseScope::Series => event.series_master_id.as_deref() == Some(&reply.target),
        };
        if !hit || event.cancelled {
            continue;
        }
        event.response = Some(answer);
        event.show_as = match (reply.kind, event.show_as) {
            (ResponseKind::Tentative, _) => Some(ShowAs::Tentative),
            (ResponseKind::Accept, Some(ShowAs::Tentative)) => Some(ShowAs::Busy),
            (_, other) => other,
        };
    }
}

#[tauri::command]
#[specta::specta]
pub async fn calendar_respond(
    app: tauri::AppHandle,
    event_id: String,
    request: ResponseRequest,
) -> Result<Snapshot, String> {
    let _operation = OPERATION.lock().await;
    let mut snapshot = calendar_status(app.clone())?;
    let event = snapshot
        .events
        .iter()
        .find(|e| e.id == event_id)
        .ok_or("calendar.eventMissing")?;
    let reply = prepare(event, &request, Utc::now())?;
    let url = reply_url(&reply)?;
    let (credentials, tokens) = refresh(&app).await?;
    let storage_app = app.clone();
    blocking(move || write_credentials(&storage_app, &credentials)).await?;
    let outcome = if granted(tokens.scope.as_deref()).is_some_and(|a| !a.write) {
        Err(RECONNECT.to_string())
    } else {
        deliver(&client()?, url, &tokens.access_token, &reply.body).await
    };
    if let Err(code) = outcome {
        if code == RECONNECT {
            snapshot.category_access.write = false;
            let app = app.clone();
            blocking(move || save(&app, &snapshot)).await?;
        }
        return Err(code);
    }
    apply_response(&mut snapshot, &reply);
    snapshot.category_access.write = true;
    let cached = snapshot.clone();
    // Graph has it now: this must not read as a failure, or a retry sends it twice.
    if let Err(code) = blocking(move || save(&app, &cached)).await {
        tracing::warn!(code, "calendar response sent, cache not updated");
    }
    Ok(snapshot)
}

#[cfg(test)]
#[path = "respond_delivery_tests.rs"]
mod delivery_tests;
#[cfg(test)]
#[path = "respond_tests.rs"]
mod tests;
