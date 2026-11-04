//! Meeting summaries, detail and search for `Coxinha cli`.
use super::data::{self, CalendarEvent, Session};
use crate::calendar::Candidate;
use chrono::{DateTime, Local, NaiveDate, Utc};
use coxinha_core::processing::ProcessingReport;
use serde::Serialize;

const MATCH_WINDOW_MINUTES: i64 = 30;

/// Lowercase and without Latin accents, like `normalize` in meetingRows.ts.
pub fn fold(text: &str) -> String {
    text.trim()
        .chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

fn instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|d| d.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|n| n.and_utc())
        })
}

/// The session's event: same title within 30 minutes, or identical start and
/// end (`matchEvent` in the frontend). Each event is claimed once.
pub fn match_events<'a>(
    sessions: &[Session],
    events: &'a [CalendarEvent],
) -> Vec<Option<&'a CalendarEvent>> {
    let mut claimed = vec![false; events.len()];
    sessions
        .iter()
        .map(|session| {
            let start = session.starts_at.as_deref().and_then(instant)?;
            let end = session.ends_at.as_deref().and_then(instant);
            let title = fold(&session.title);
            let found = events.iter().enumerate().find(|(i, event)| {
                if claimed[*i] {
                    return false;
                }
                let Some(event_start) = instant(&event.starts_at) else {
                    return false;
                };
                let gap = (event_start - start).num_minutes().abs();
                if fold(&event.title) == title && gap <= MATCH_WINDOW_MINUTES {
                    return true;
                }
                gap == 0 && end.is_some() && end == instant(&event.ends_at)
            });
            found.map(|(i, event)| {
                claimed[i] = true;
                event
            })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub status: String,
    pub participants: Vec<Candidate>,
    pub organizer: Option<Candidate>,
    pub categories: Vec<String>,
    pub outlook_event_id: Option<String>,
    pub note_path: Option<String>,
    pub has_recording: bool,
    pub folder: Option<String>,
}

/// Invitees first, then names the owner added, without repeats.
pub fn participants(event: Option<&CalendarEvent>, added: Vec<Candidate>) -> Vec<Candidate> {
    let mut all: Vec<Candidate> = Vec::new();
    for person in event
        .map(|e| e.attendees.clone())
        .unwrap_or_default()
        .into_iter()
        .chain(added)
    {
        let same = |p: &Candidate| match (&p.email, &person.email) {
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
            _ => fold(&p.name) == fold(&person.name),
        };
        if !all.iter().any(same) {
            all.push(person);
        }
    }
    all
}

/// When the meeting happens: scheduled start, else the recording's start
/// (`sessionDate` in the frontend).
pub fn start(session: &Session) -> Option<DateTime<Utc>> {
    session
        .starts_at
        .as_deref()
        .and_then(instant)
        .or_else(|| session.recorded_at.as_deref().and_then(instant))
}

/// The civil day the app names the item folder after, in local time.
pub fn civil_date(session: &Session) -> Option<String> {
    start(session).map(|t| t.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

pub fn local_day(session: &Session) -> Option<NaiveDate> {
    civil_date(session).and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
}

#[derive(Default)]
pub struct Filters {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub person: Option<String>,
    pub category: Option<String>,
    pub query: Option<String>,
}

pub fn keep(summary: &Summary, day: Option<NaiveDate>, f: &Filters) -> bool {
    if let Some(from) = f.from {
        if day.is_none_or(|d| d < from) {
            return false;
        }
    }
    if let Some(to) = f.to {
        if day.is_none_or(|d| d > to) {
            return false;
        }
    }
    if let Some(person) = f.person.as_deref().map(fold) {
        let hit = summary
            .participants
            .iter()
            .chain(summary.organizer.iter())
            .any(|p| {
                fold(&p.name).contains(&person)
                    || p.email
                        .as_deref()
                        .is_some_and(|e| fold(e).contains(&person))
            });
        if !hit {
            return false;
        }
    }
    if let Some(category) = f.category.as_deref().map(fold) {
        if !summary.categories.iter().any(|c| fold(c) == category) {
            return false;
        }
    }
    if let Some(query) = f.query.as_deref().map(fold) {
        if !fold(&summary.title).contains(&query) {
            return false;
        }
    }
    true
}

/// "[mm:ss] Name: text", corrections applied, names only when confirmed.
pub fn transcript(report: &ProcessingReport) -> String {
    coxinha_core::processing::named_transcript(report)
}

/// Up to `width` characters around the first match, on one line.
pub fn snippet(text: &str, query: &str, width: usize) -> Option<String> {
    let folded: Vec<char> = fold(text).chars().collect();
    let original: Vec<char> = text.trim().chars().collect();
    let needle: Vec<char> = fold(query).chars().collect();
    if needle.is_empty() || folded.len() != original.len() {
        return fold(text)
            .contains(&fold(query))
            .then(|| original.iter().take(width).collect());
    }
    let at = folded
        .windows(needle.len())
        .position(|w| w == needle.as_slice())?;
    let start = at.saturating_sub(width / 2);
    let end = (start + width).min(original.len());
    let mut out: String = original[start..end].iter().collect();
    out = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        out.insert(0, '…');
    }
    if end < original.len() {
        out.push('…');
    }
    Some(out)
}

pub fn has_report(report: &Option<ProcessingReport>) -> bool {
    report.as_ref().is_some_and(|r| !r.segments.is_empty())
}

pub fn note_text(paths: &super::paths::Paths, session: &Session) -> Option<String> {
    session
        .note_path
        .as_deref()
        .and_then(|p| data::note_body(paths, p))
}
