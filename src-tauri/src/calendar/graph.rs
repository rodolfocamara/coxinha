use super::*;
/// Spec 0124 P1: far enough ahead that later weeks stop looking empty.
const DAYS_BACK: i64 = 30;
const DAYS_AHEAD: i64 = 180;
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 50;
const MAX_EVENTS: usize = 5000;
const SELECT: &str = "id,subject,start,end,isCancelled,isAllDay,attendees,organizer,seriesMasterId,type,originalStart,categories,responseStatus,location,onlineMeeting,bodyPreview,showAs,isOrganizer,webLink,allowNewTimeProposals,responseRequested";
fn window(now: chrono::DateTime<Utc>) -> (chrono::DateTime<Utc>, chrono::DateTime<Utc>) {
    (
        now - Duration::days(DAYS_BACK),
        now + Duration::days(DAYS_AHEAD),
    )
}
pub(super) fn graph_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| SAFE_ERROR)?;
    if url.scheme() != "https"
        || url.host_str() != Some("graph.microsoft.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/v1.0/me/calendarView"
        || url.fragment().is_some()
    {
        return Err("calendar.pagingInvalid".into());
    }
    Ok(url)
}
pub(super) async fn fetch(access: &str, attempt: Option<&str>) -> Result<Snapshot, String> {
    let http = client()?;
    // OIDC userinfo binds the cache to the authenticated subject without User.Read.
    let user: serde_json::Value = http
        .get("https://graph.microsoft.com/oidc/userinfo")
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| SAFE_ERROR)?
        .error_for_status()
        .map_err(|_| SAFE_ERROR)?
        .json()
        .await
        .map_err(|_| SAFE_ERROR)?;
    let account = user["sub"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or(SAFE_ERROR)?
        .to_string();
    let (from, to) = window(Utc::now());
    let mut url = graph_url("https://graph.microsoft.com/v1.0/me/calendarView")?;
    url.query_pairs_mut().extend_pairs([
        // Spec 0100: a month back, so earlier recordings can be matched.
        ("startDateTime", from.to_rfc3339()),
        ("endDateTime", to.to_rfc3339()),
        ("$top", PAGE_SIZE.to_string()),
        ("$select", SELECT.into()),
    ]);
    let mut events = Vec::new();
    let mut visited = std::collections::HashSet::new();
    for _ in 0..MAX_PAGES {
        if attempt.is_some_and(|id| !active(id)) {
            return Err("calendar.cancelled".into());
        }
        if !visited.insert(url.to_string()) {
            return Err("calendar.pagingRepeated".into());
        }
        let page: serde_json::Value = http
            .get(url)
            .bearer_auth(access)
            .header("Prefer", "outlook.timezone=\"UTC\", IdType=\"ImmutableId\"")
            .send()
            .await
            .map_err(|_| SAFE_ERROR)?
            .error_for_status()
            .map_err(|_| SAFE_ERROR)?
            .json()
            .await
            .map_err(|_| SAFE_ERROR)?;
        for item in page["value"].as_array().ok_or(SAFE_ERROR)? {
            events.push(parse_event(item)?);
            if events.len() > MAX_EVENTS {
                return Err("calendar.eventLimit".into());
            }
        }
        match page.get("@odata.nextLink") {
            None => {
                events.sort_by(|a, b| a.starts_at.cmp(&b.starts_at));
                return Ok(Snapshot {
                    account: Some(account),
                    synced_at: Some(Utc::now().to_rfc3339()),
                    events,
                    ..Snapshot::default()
                });
            }
            Some(next) => url = graph_url(next.as_str().ok_or(SAFE_ERROR)?)?,
        }
    }
    Err("calendar.pageLimit".into())
}
pub(super) fn parse_event(item: &serde_json::Value) -> Result<Event, String> {
    let string = |key: &str| {
        item[key]
            .as_str()
            .map(str::to_string)
            .ok_or(SAFE_ERROR.to_string())
    };
    let date = |key: &str| -> Result<String, String> {
        let raw = item[key]["dateTime"].as_str().ok_or(SAFE_ERROR)?;
        if item[key]["timeZone"].as_str() != Some("UTC") {
            return Err(SAFE_ERROR.into());
        }
        let utc = if raw.ends_with('Z') {
            raw.to_string()
        } else {
            format!("{raw}Z")
        };
        Ok(chrono::DateTime::parse_from_rfc3339(&utc)
            .map_err(|_| SAFE_ERROR)?
            .with_timezone(&Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
    };
    let attendees = item["attendees"]
        .as_array()
        .ok_or(SAFE_ERROR)?
        .iter()
        .filter_map(|a| {
            let address = &a["emailAddress"];
            let name = address["name"].as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(Candidate {
                name: name.into(),
                email: address["address"].as_str().map(str::to_string),
            })
        })
        .collect();
    Ok(Event {
        id: string("id")?,
        title: string("subject")?,
        starts_at: date("start")?,
        ends_at: date("end")?,
        cancelled: item["isCancelled"].as_bool().ok_or(SAFE_ERROR)?,
        all_day: item["isAllDay"].as_bool().ok_or(SAFE_ERROR)?,
        attendees,
        organizer: item.get("organizer").and_then(|organizer| {
            let address = &organizer["emailAddress"];
            Some(Candidate {
                name: address["name"].as_str()?.to_string(),
                email: address["address"].as_str().map(str::to_string),
            })
        }),
        series_master_id: item["seriesMasterId"].as_str().map(str::to_string),
        event_type: item["type"].as_str().map(str::to_string),
        original_start: item["originalStart"].as_str().map(str::to_string),
        categories: event_categories(item),
        response: details::response_of(item),
        attendee_responses: details::attendee_responses(item),
        location: details::location(item),
        join_url: details::join_url(item["onlineMeeting"]["joinUrl"].as_str()),
        body_preview: details::body_preview(item),
        show_as: details::show_as_of(item),
        is_organizer: item["isOrganizer"].as_bool().unwrap_or(false),
        web_link: details::web_link(item["webLink"].as_str()),
        allow_new_time_proposals: item["allowNewTimeProposals"].as_bool(),
        response_requested: item["responseRequested"].as_bool(),
    })
}

#[cfg(test)]
#[path = "graph_tests.rs"]
mod tests;
