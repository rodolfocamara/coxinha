//! `Coxinha cli …` (spec 0106): JSON access to meetings for scripts and AI
//! agents. Reads are read-only; writes go through the app's item rules.
mod args;
pub(crate) mod data;
mod meetings;
pub(crate) mod paths;
pub(crate) mod search;
pub(crate) mod universal;
mod write;

#[cfg(test)]
mod tests;

use crate::items::{files, folder, links};
use args::Args;
use data::Session;
use meetings::{Filters, Summary};
use paths::Paths;
use serde_json::{json, Value};

const HELP: &str = "Coxinha cli <command> [--vault DIR] [--data DIR]
  meetings [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--person TEXT] [--category NAME] [--query TEXT] [--limit N]
  meeting <session-id> [--no-transcript]
  search <text> [--limit N]
  activities [--query TEXT]
  add-file <meeting|activity> <id> <path>...
  add-ref <meeting|activity> <id> <path-or-url> [--label TEXT]
  link <session-id> <note-id>
  unlink <session-id> <note-id>";

/// True when the process was started as `Coxinha cli …`.
pub fn requested() -> bool {
    std::env::args().nth(1).as_deref() == Some("cli")
}

/// Runs the command after `cli`; returns the process exit code.
pub fn main() -> i32 {
    // The release exe is a GUI app on Windows; print to the calling terminal.
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
    let raw: Vec<String> = std::env::args().skip(2).collect();
    match run(&raw) {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).unwrap_or_default()
            );
            0
        }
        Err(error) => {
            eprintln!("{}", json!({ "error": error }));
            1
        }
    }
}

pub fn run(raw: &[String]) -> Result<Value, String> {
    let args = args::parse(raw)?;
    if args.command == "help" || args.switch("help") {
        return Ok(json!({ "usage": HELP }));
    }
    let paths = paths::resolve(args.flag("vault"), args.flag("data"))?;
    match args.command.as_str() {
        "meetings" => list_meetings(&paths, &args),
        "meeting" => meeting(&paths, &args),
        "search" => search(&paths, &args),
        "activities" => activities(&paths, &args),
        "add-file" | "add-ref" | "link" | "unlink" => write::run(&paths, &args),
        other => Err(format!("unknown command {other}; run help")),
    }
}

pub(crate) struct Library {
    pub sessions: Vec<Session>,
    pub events: Vec<data::CalendarEvent>,
    db: rusqlite::Connection,
    profiles: Option<rusqlite::Connection>,
}

impl Library {
    pub fn open(paths: &Paths) -> Result<Self, String> {
        let db = data::open_read_only(&paths.meetings_db())?;
        let profiles = data::open_read_only(&paths.profiles_db()).ok();
        Ok(Self {
            sessions: data::sessions(&db)?,
            events: data::outlook(paths).events,
            db,
            profiles,
        })
    }

    pub fn session(&self, id: &str) -> Result<&Session, String> {
        self.sessions
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("no meeting {id}"))
    }

    fn report(&self, session: &Session) -> Option<coxinha_core::processing::ProcessingReport> {
        let (meeting, profiles) = (session.meeting_id.as_deref()?, self.profiles.as_ref()?);
        coxinha_core::processing::latest_report(&self.db, profiles, meeting)
            .ok()
            .flatten()
    }

    /// Spec 0108: the generated summary, if the app wrote one.
    pub(crate) fn generated_summary(&self, session: &Session) -> Option<Value> {
        let meeting = session.meeting_id.as_deref()?;
        coxinha_core::store::read_summary(&self.db, meeting)
            .ok()
            .flatten()
            .map(|s| json!({ "markdown": s.markdown, "generatedAt": s.generated_at }))
    }

    fn summaries(&self, paths: &Paths) -> Vec<(Summary, &Session)> {
        let matched = meetings::match_events(&self.sessions, &self.events);
        self.sessions
            .iter()
            .zip(matched)
            .map(|(session, event)| {
                let added =
                    data::participants(self.profiles.as_ref(), session.meeting_id.as_deref());
                let summary = Summary {
                    id: session.id.clone(),
                    title: session.title.clone(),
                    starts_at: meetings::start(session).map(|t| t.to_rfc3339()),
                    ends_at: session.ends_at.clone(),
                    status: session.status.clone(),
                    participants: meetings::participants(event, added),
                    organizer: event.and_then(|e| e.organizer.clone()),
                    categories: event.map(|e| e.categories.clone()).unwrap_or_default(),
                    outlook_event_id: event.map(|e| e.id.clone()),
                    note_path: session.note_path.clone(),
                    has_recording: session.meeting_id.is_some(),
                    folder: folder::locate(&paths.vault, &item_of(session))
                        .ok()
                        .flatten()
                        .map(|p| p.display().to_string()),
                };
                (summary, session)
            })
            .collect()
    }
}

pub(crate) fn item_of(session: &Session) -> folder::ItemRef {
    folder::ItemRef {
        kind: folder::ItemKind::Meeting,
        id: session.id.clone(),
        title: session.title.clone(),
        date: meetings::civil_date(session),
    }
}

fn list_meetings(paths: &Paths, args: &Args) -> Result<Value, String> {
    let library = Library::open(paths)?;
    let filters = Filters {
        from: args.date("from")?,
        to: args.date("to")?,
        person: args.flag("person").map(str::to_string),
        category: args.flag("category").map(str::to_string),
        query: args.flag("query").map(str::to_string),
    };
    let limit = args.limit(50)?;
    let found: Vec<Summary> = library
        .summaries(paths)
        .into_iter()
        .filter(|(summary, session)| {
            meetings::keep(summary, meetings::local_day(session), &filters)
        })
        .map(|(summary, _)| summary)
        .take(limit)
        .collect();
    Ok(json!({ "count": found.len(), "meetings": found }))
}

fn meeting(paths: &Paths, args: &Args) -> Result<Value, String> {
    let library = Library::open(paths)?;
    let id = args.arg(0, "session id")?;
    let (summary, session) = library
        .summaries(paths)
        .into_iter()
        .find(|(_, s)| s.id == id)
        .ok_or_else(|| format!("no meeting {id}"))?;
    let report = library.report(session);
    let files = files::list_readonly(&paths.vault, &item_of(session))?;
    let titles = data::notes(paths).unwrap_or_default();
    let linked: Vec<Value> = links::list(&paths.vault, Some(id), None)?
        .into_iter()
        .map(|link| {
            let note = titles.iter().find(|n| n.id == link.note);
            json!({
                "noteId": link.note,
                "title": note.map(|n| n.title.clone()),
                "path": note.map(|n| n.path.clone()),
                "missing": note.is_none(),
            })
        })
        .collect();
    let transcript = (!args.switch("no-transcript"))
        .then(|| report.as_ref().map(meetings::transcript))
        .flatten();
    Ok(json!({
        "meeting": summary,
        "notes": meetings::note_text(paths, session),
        "summary": library.generated_summary(session),
        "hasTranscript": meetings::has_report(&report),
        "transcript": transcript,
        "files": files,
        "activities": linked,
    }))
}

fn search(paths: &Paths, args: &Args) -> Result<Value, String> {
    let query = args.arg(0, "search text")?;
    let hits = search::search(paths, query, args.limit(20)?)?;
    Ok(json!({ "count": hits.len(), "results": hits }))
}

/// Meeting notes and daily notes are not activities.
pub(crate) fn is_plain_note(path: &str) -> bool {
    !path.starts_with("daily/") && !path.starts_with("notes/session-")
}

fn activities(paths: &Paths, args: &Args) -> Result<Value, String> {
    let cards = data::board_cards(paths);
    let query = args.flag("query").map(meetings::fold);
    let found: Vec<Value> = data::notes(paths)?
        .into_iter()
        .filter(|n| is_plain_note(&n.path))
        .filter(|n| {
            query
                .as_ref()
                .is_none_or(|q| meetings::fold(&n.title).contains(q))
        })
        .map(|n| {
            json!({
                "id": n.id,
                "title": n.title,
                "path": n.path,
                "onBoard": cards.contains(&n.id),
            })
        })
        .collect();
    Ok(json!({ "count": found.len(), "activities": found }))
}
