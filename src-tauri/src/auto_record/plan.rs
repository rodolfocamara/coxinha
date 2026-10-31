//! Pure start planning for an automatic capture (spec 0097 P2): which
//! calendar event names the call, which session to reuse and which devices.
use crate::calendar::{Candidate, Event};
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;

const EARLY: i64 = 10;
const SAME_SESSION_MINUTES: i64 = 30;

fn instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}
/// Session timestamps are exactly `YYYY-MM-DDTHH:MM:SSZ`.
pub fn session_time(value: &str) -> Option<String> {
    instant(value).map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

/// The event running now (or starting within 10 min): nearest start wins,
/// then the shorter one. Cancelled and all-day events never name a call.
pub fn current_event(events: &[Event], now: DateTime<Utc>) -> Option<&Event> {
    events
        .iter()
        .filter(|e| !e.cancelled && !e.all_day && !e.title.trim().is_empty())
        .filter_map(|e| Some((e, instant(&e.starts_at)?, instant(&e.ends_at)?)))
        .filter(|(_, start, end)| *start - Duration::minutes(EARLY) <= now && now <= *end)
        .min_by_key(|(_, start, end)| ((*start - now).num_seconds().abs(), *end - *start))
        .map(|(e, _, _)| e)
}

/// A planned or active session for this event that has no recording yet.
pub fn reusable_session(sessions: &Value, event: &Event) -> Option<String> {
    let start = instant(&event.starts_at)?;
    let title = event.title.trim().to_lowercase();
    sessions.as_array()?.iter().find_map(|s| {
        let open = matches!(s["status"].as_str(), Some("planned" | "active"));
        let free = s["meeting_id"].is_null();
        let same = s["title"].as_str()?.trim().to_lowercase() == title;
        let near = instant(s["starts_at"].as_str()?)
            .is_some_and(|t| (t - start).num_minutes().abs() <= SAME_SESSION_MINUTES);
        (open && free && same && near)
            .then(|| s["id"].as_str().map(str::to_owned))
            .flatten()
    })
}

/// Invitees for the participant context, deduplicated like the manual flow.
pub fn invitees(event: &Event) -> Vec<Candidate> {
    let mut people: Vec<Candidate> = Vec::new();
    for p in event.attendees.iter().chain(event.organizer.iter()) {
        let duplicate = people.iter().any(|o| match (&p.email, &o.email) {
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
            (None, None) => p.name.trim().eq_ignore_ascii_case(o.name.trim()),
            _ => false,
        });
        if !duplicate && !p.name.trim().is_empty() {
            people.push(p.clone());
        }
    }
    people.truncate(100);
    people
}

/// Saved device if it still exists, else the system default of that kind.
pub fn pick_source(sources: &Value, monitor: bool, saved: Option<&str>) -> Option<String> {
    let list = sources.as_array()?;
    let kind = |s: &&Value| s["monitor"].as_bool() == Some(monitor);
    let name = |s: &Value| s["name"].as_str().map(str::to_owned);
    saved
        .and_then(|wanted| list.iter().filter(kind).find(|s| s["name"] == wanted))
        .or_else(|| {
            list.iter()
                .filter(kind)
                .find(|s| s["is_default"].as_bool() == Some(true))
        })
        .or_else(|| list.iter().find(kind))
        .and_then(name)
}

#[cfg(test)]
#[path = "plan_tests.rs"]
mod tests;
