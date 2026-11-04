//! Spec 0100: offers each earlier recording the calendar event it overlaps
//! and applies the owner's answer. Nothing changes before "É essa reunião".
use super::*;
use crate::auto_record::plan;
use crate::calendar::{Candidate, Event};
use crate::storage::Storage;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use coxinha_core::store::session::NewSession;
use std::collections::BTreeSet;
use std::sync::Arc;

const MIN_RECORDING_SECONDS: i64 = 60;
const ENOUGH_OVERLAP_MINUTES: i64 = 10;
const DECISIONS: &str = "calendar-matches.json";

pub(super) struct Recording {
    pub session: String,
    pub meeting: String,
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Decisions {
    /// `session:event` pairs the owner said are different meetings.
    dismissed: BTreeSet<String>,
}

fn instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}
fn key(session: &str, event: &str) -> String {
    format!("{session}:{event}")
}
fn same_title(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// The event each recording overlaps most, when the overlap is at least half
/// the recording or 10 minutes. Events without invitees (lunch, focus time)
/// are personal blocks, not meetings. A session already named after a
/// qualifying event is matched; a dismissed pair is never offered again.
pub(super) fn propose<'a>(
    recordings: &[Recording],
    events: &'a [Event],
    dismissed: &BTreeSet<String>,
) -> Vec<(usize, &'a Event)> {
    let mut proposals = Vec::new();
    for (index, recording) in recordings.iter().enumerate() {
        let length = recording.end - recording.start;
        if length < Duration::seconds(MIN_RECORDING_SECONDS) {
            continue;
        }
        let needed = (length / 2).min(Duration::minutes(ENOUGH_OVERLAP_MINUTES));
        let candidates: Vec<_> = events
            .iter()
            .filter(|e| {
                !e.cancelled && !e.all_day && !e.title.trim().is_empty() && !e.attendees.is_empty()
            })
            .filter_map(|e| {
                let (start, end) = (instant(&e.starts_at)?, instant(&e.ends_at)?);
                let overlap = end.min(recording.end) - start.max(recording.start);
                let distance = (start - recording.start).num_seconds().abs();
                (overlap >= needed).then_some((e, overlap, distance))
            })
            .collect();
        if candidates
            .iter()
            .any(|(e, ..)| same_title(&e.title, &recording.title))
        {
            continue;
        }
        let best = candidates
            .into_iter()
            .filter(|(e, ..)| !dismissed.contains(&key(&recording.session, &e.id)))
            .max_by(|a, b| a.1.cmp(&b.1).then(b.2.cmp(&a.2)));
        if let Some((event, ..)) = best {
            proposals.push((index, event));
        }
    }
    proposals
}

/// Invitees join the participants already there, deduplicated by e-mail,
/// else by name.
pub(super) fn merge(existing: Vec<Candidate>, invitees: Vec<Candidate>) -> Vec<Candidate> {
    let same = |a: &Candidate, b: &Candidate| match (&a.email, &b.email) {
        (Some(x), Some(y)) => x.eq_ignore_ascii_case(y),
        _ => a.name.trim().eq_ignore_ascii_case(b.name.trim()),
    };
    let mut people = existing;
    for person in invitees {
        if !people.iter().any(|p| same(p, &person)) {
            people.push(person);
        }
    }
    people.truncate(100);
    people
}

/// Sessions with a closed capture, timed by `created_at` (UTC) and the
/// longest track of the manifest.
pub(super) fn recordings(root: &std::path::Path, sessions: &Value) -> Vec<Recording> {
    let Some(sessions) = sessions.as_array() else {
        return Vec::new();
    };
    sessions
        .iter()
        .filter_map(|s| {
            let recording = &s["recording"];
            let closed = matches!(
                recording["captureState"].as_str(),
                Some("finished" | "interrupted")
            );
            let meeting = s["meeting_id"].as_str().filter(|_| closed)?;
            let start = NaiveDateTime::parse_from_str(
                recording["createdAt"].as_str()?,
                "%Y-%m-%d %H:%M:%S",
            )
            .ok()?
            .and_utc();
            let manifest: CaptureManifest =
                std::fs::File::open(root.join("raw").join(meeting).join("manifest.json"))
                    .ok()
                    .and_then(|f| serde_json::from_reader(f).ok())?;
            let ms = super::recording_storage::snapshot(root, meeting, Some(&manifest))
                ["durationMs"]
                .as_i64()?;
            Some(Recording {
                session: s["id"].as_str()?.to_owned(),
                meeting: meeting.to_owned(),
                title: s["title"].as_str().unwrap_or_default().to_owned(),
                start,
                end: start + Duration::milliseconds(ms),
            })
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub async fn library_calendar_matches(
    app: tauri::AppHandle,
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
) -> Result<Value, String> {
    let events = crate::calendar::calendar_status(app.clone())
        .unwrap_or_default()
        .events;
    let recordings = super::reconcile::reconcile(&state, storage.inner(), &events).await?;
    let decisions: Decisions = crate::settings_file::app_file(&app, DECISIONS)
        .map(|p| crate::settings_file::load(&p))
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let proposals = propose(&recordings, &events, &decisions.dismissed);
        json!(proposals
            .into_iter()
            .map(|(i, event)| {
                let r = &recordings[i];
                json!({
                    "sessionId": r.session,
                    "meetingId": r.meeting,
                    "title": r.title,
                    "startsAt": r.start.to_rfc3339(),
                    "endsAt": r.end.to_rfc3339(),
                    "event": event,
                })
            })
            .collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn library_resolve_calendar_match(
    app: tauri::AppHandle,
    state: State<'_, Library>,
    storage: State<'_, Arc<Storage>>,
    session_id: String,
    event_id: String,
    accept: bool,
) -> Result<Value, String> {
    if !accept {
        let path = crate::settings_file::app_file(&app, DECISIONS)?;
        let mut decisions: Decisions = crate::settings_file::load(&path);
        decisions.dismissed.insert(key(&session_id, &event_id));
        crate::settings_file::save(&path, &decisions)?;
        return Ok(Value::Null);
    }
    let event = crate::calendar::calendar_status(app)?
        .events
        .into_iter()
        .find(|e| e.id == event_id)
        .ok_or("calendar event no longer in the agenda")?;
    let session = state
        .ask(Action::Session(SessionAction::Detail(session_id.clone())))
        .await?;
    let input = NewSession {
        title: event.title.trim().to_owned(),
        starts_at: plan::session_time(&event.starts_at),
        ends_at: plan::session_time(&event.ends_at),
        status: serde_json::from_value(session["status"].clone()).map_err(|e| e.to_string())?,
    };
    let updated = state
        .update_session(storage.inner(), &session_id, input)
        .await?;
    if let Some(meeting) = updated["meeting_id"].as_str() {
        let existing = state
            .ask(Action::ParticipantContext(meeting.to_owned()))
            .await?;
        let existing = serde_json::from_value(existing).unwrap_or_default();
        let people = merge(existing, plan::invitees(&event));
        state.set_participants(meeting, json!(people)).await?;
    }
    // Spec 0115 P3: the session prepared for the event takes the recording.
    match super::absorb::into_prepared(&state, storage.inner(), &session_id, &event).await? {
        Some(kept) => {
            state
                .ask(Action::Session(SessionAction::Detail(kept)))
                .await
        }
        None => Ok(updated),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(hour: u32, minute: u32) -> DateTime<Utc> {
        chrono::NaiveDate::from_ymd_opt(2026, 10, 29)
            .unwrap()
            .and_hms_opt(hour, minute, 0)
            .unwrap()
            .and_utc()
    }
    fn event(id: &str, title: &str, from: (u32, u32), to: (u32, u32)) -> Event {
        serde_json::from_value(json!({
            "id": id, "title": title,
            "startsAt": at(from.0, from.1).to_rfc3339(), "endsAt": at(to.0, to.1).to_rfc3339(),
            "cancelled": false, "allDay": false,
            "attendees": [{ "name": "Ana", "email": "ana@x.com" }],
        }))
        .unwrap()
    }
    fn recording(title: &str, from: (u32, u32), to: (u32, u32)) -> Recording {
        Recording {
            session: "s1".into(),
            meeting: "m1".into(),
            title: title.into(),
            start: at(from.0, from.1),
            end: at(to.0, to.1),
        }
    }
    fn ids(proposals: Vec<(usize, &Event)>) -> Vec<(usize, String)> {
        proposals
            .into_iter()
            .map(|(i, e)| (i, e.id.clone()))
            .collect()
    }

    #[test]
    fn offers_the_event_with_the_longest_overlap() {
        let events = [
            event("short", "Café", (9, 0), (9, 15)),
            event("long", "Comitê de TI", (9, 0), (11, 0)),
        ];
        let recordings = [recording("Meeting in Google Chrome", (9, 19), (11, 8))];
        let none = BTreeSet::new();
        assert_eq!(
            ids(propose(&recordings, &events, &none)),
            [(0, "long".into())]
        );
    }

    #[test]
    fn needs_half_the_recording_or_ten_minutes_and_skips_short_or_cancelled() {
        let mut cancelled = event("x", "Cancelada", (9, 0), (10, 0));
        cancelled.cancelled = true;
        let mut all_day = event("d", "Feriado", (0, 0), (23, 59));
        all_day.all_day = true;
        let events = [
            cancelled,
            all_day,
            event("late", "Daily", (9, 55), (10, 30)),
        ];
        let none = BTreeSet::new();
        // 5 of 60 minutes overlap: neither half nor 10 minutes.
        let hour = [recording("Gravação", (9, 0), (10, 0))];
        assert!(propose(&hour, &events, &none).is_empty());
        // 5 of 8 minutes overlap: more than half.
        let short = [recording("Gravação", (9, 52), (10, 0))];
        assert_eq!(ids(propose(&short, &events, &none)), [(0, "late".into())]);
        // A test clip under a minute is never offered.
        let clip = [recording("teste", (10, 0), (10, 0))];
        assert!(propose(&clip, &events, &none).is_empty());
    }

    #[test]
    fn ignores_events_without_invitees() {
        let mut lunch = event("lunch", "Lunch", (12, 0), (13, 0));
        lunch.attendees.clear();
        let recordings = [recording("Meeting in Google Chrome", (12, 0), (12, 50))];
        assert!(propose(&recordings, &[lunch], &BTreeSet::new()).is_empty());
    }

    #[test]
    fn never_offers_a_named_session_or_a_dismissed_pair() {
        let events = [
            event("a", "Comitê de TI", (9, 0), (11, 0)),
            event("b", "Almoço", (9, 30), (10, 30)),
        ];
        let named = [recording(" comitê de ti ", (9, 0), (11, 0))];
        let none = BTreeSet::new();
        assert!(propose(&named, &events, &none).is_empty());
        let other = [recording("Meeting", (9, 0), (11, 0))];
        let dismissed = BTreeSet::from([key("s1", "a")]);
        assert_eq!(ids(propose(&other, &events, &dismissed)), [(0, "b".into())]);
    }

    #[test]
    fn invitees_join_existing_participants_without_duplicates() {
        let person = |name: &str, email: Option<&str>| Candidate {
            name: name.into(),
            email: email.map(str::to_owned),
        };
        let merged = merge(
            vec![person("Ana", Some("ana@x.com")), person("Bruno", None)],
            vec![
                person("Ana Souza", Some("ANA@x.com")),
                person("bruno", None),
                person("Carla", Some("carla@x.com")),
            ],
        );
        let names: Vec<_> = merged.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Ana", "Bruno", "Carla"]);
    }
}
