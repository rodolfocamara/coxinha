//! What the signals are read from. Everything is read once per call, never
//! once per session, and each read has a limit.
use crate::cli::paths::Paths;
use crate::items::folder::{self, ItemKind, Reference, MARKER};
use chrono::{DateTime, Utc};
use coxinha_core::processing::ProcessingResult;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

const MAX_FOLDERS: usize = 5000;
const MAX_FOLDER_ENTRIES: usize = 500;
const NOTE_PREFIX_BYTES: u64 = 64 * 1024;
const MAX_PARSED: usize = 4096;
const DIAGRAM_ENDINGS: [&str; 5] = [
    ".excalidraw",
    ".excalidraw.json",
    ".drawio",
    ".mmd",
    ".mermaid",
];
const DIAGRAM_HOSTS: [&str; 2] = ["excalidraw.com", "app.diagrams.net"];

/// The part of a finished run the signals use.
pub(super) struct Run {
    pub spoken: bool,
    /// `(track, speaker)`, once each.
    pub speakers: HashSet<(String, String)>,
}

/// Counted like the meeting page's lanes: `unknown` speech is not a speaker.
fn run_of(json: &str) -> Run {
    let Ok(result) = serde_json::from_str::<ProcessingResult>(json) else {
        return Run {
            spoken: false,
            speakers: HashSet::new(),
        };
    };
    let spoken = result.segments.iter().any(|s| !s.text.trim().is_empty());
    let usable = |speaker: &str, start: u64, end: u64| speaker != "unknown" && end > start;
    let speakers = if result.turns.is_empty() {
        result
            .segments
            .iter()
            .filter_map(|s| {
                let speaker = s.speaker.as_deref()?;
                usable(speaker, s.start_ms, s.end_ms).then(|| (s.track.clone(), speaker.to_owned()))
            })
            .collect()
    } else {
        result
            .turns
            .iter()
            .filter(|t| usable(&t.speaker, t.start_ms, t.end_ms))
            .map(|t| (t.track.clone(), t.speaker.clone()))
            .collect()
    };
    Run { spoken, speakers }
}

/// A job's result never changes after it succeeds, so each is parsed once.
fn parsed() -> &'static Mutex<HashMap<String, Arc<Run>>> {
    static PARSED: OnceLock<Mutex<HashMap<String, Arc<Run>>>> = OnceLock::new();
    PARSED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Latest successful run per meeting, as `TranscriptStatus` chooses it.
pub(super) fn runs(db: &Connection) -> Result<HashMap<String, (String, Arc<Run>)>, String> {
    let latest: Vec<(String, String)> = {
        let mut query = db
            .prepare(
                "SELECT j.meeting_id, j.id FROM (
                   SELECT j.meeting_id, MAX(j.rowid) AS job_rowid
                   FROM job j JOIN processing_run r ON r.job_id = j.id
                   WHERE j.state = 'succeeded' GROUP BY j.meeting_id
                 ) latest JOIN job j ON j.rowid = latest.job_rowid",
            )
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    let mut query = db
        .prepare("SELECT result_json FROM processing_run WHERE job_id=?1")
        .map_err(|e| e.to_string())?;
    let mut all = HashMap::new();
    for (meeting, job) in latest {
        let known = parsed()
            .lock()
            .map_err(|_| "signals lock poisoned")?
            .get(&job)
            .cloned();
        let run = match known {
            Some(run) => run,
            None => {
                let json: Option<String> = query
                    .query_row([&job], |r| r.get(0))
                    .map_err(|e| e.to_string())?;
                let run = Arc::new(run_of(json.as_deref().unwrap_or_default()));
                let mut cache = parsed().lock().map_err(|_| "signals lock poisoned")?;
                if cache.len() >= MAX_PARSED {
                    cache.clear();
                }
                cache.insert(job.clone(), run.clone());
                run
            }
        };
        all.insert(meeting, (job, run));
    }
    Ok(all)
}

/// `job:track:speaker` keys of speakers the owner named.
pub(super) fn named(paths: &Paths) -> HashSet<String> {
    let Ok(profiles) = crate::cli::data::open_read_only(&paths.profiles_db()) else {
        return HashSet::new();
    };
    let query = profiles.prepare(
        "SELECT a.speaker FROM assignment a JOIN person p ON p.id=a.person_id
         WHERE a.state='confirmed'",
    );
    let Ok(mut query) = query else {
        return HashSet::new();
    };
    let rows = query.query_map([], |r| r.get::<_, String>(0));
    rows.map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// Meeting id and markdown. An older library without the table has no summaries.
pub(super) fn summaries(db: &Connection) -> HashMap<String, String> {
    let Ok(mut query) = db.prepare("SELECT meeting_id, markdown FROM meeting_summary") else {
        return HashMap::new();
    };
    let rows = query.query_map([], |r| Ok((r.get(0)?, r.get(1)?)));
    rows.map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

pub(super) struct Note {
    pub filled: bool,
    pub modified: Option<DateTime<Utc>>,
}

pub(super) fn note(vault: &Path, relative: &str) -> Option<Note> {
    let path = vault.join(relative);
    if relative.contains("..") || !path.starts_with(vault) {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let modified = file
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .map(DateTime::<Utc>::from);
    let mut bytes = Vec::new();
    file.take(NOTE_PREFIX_BYTES).read_to_end(&mut bytes).ok()?;
    Some(Note {
        filled: !crate::library::blank_note(&String::from_utf8_lossy(&bytes)),
        modified,
    })
}

pub(super) struct FolderFile {
    pub name: String,
    pub modified: Option<DateTime<Utc>>,
}

#[derive(Default)]
pub(super) struct Folder {
    pub files: Vec<FolderFile>,
    pub references: Vec<Reference>,
}

/// One pass over `meetings/`: `folder::locate` per session would read every
/// marker once per session.
pub(super) fn folders(vault: &Path) -> HashMap<String, Folder> {
    let mut all = HashMap::new();
    let Ok(entries) = std::fs::read_dir(vault.join("meetings")) else {
        return all;
    };
    for entry in entries.flatten().take(MAX_FOLDERS) {
        let dir = entry.path();
        let Some(marker) = folder::read_marker(&dir) else {
            continue;
        };
        if marker.kind != ItemKind::Meeting {
            continue;
        }
        let mut files = Vec::new();
        for file in std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .take(MAX_FOLDER_ENTRIES)
        {
            let name = file.file_name().to_string_lossy().into_owned();
            let Ok(meta) = file.metadata() else { continue };
            if name != MARKER && meta.is_file() {
                files.push(FolderFile {
                    name,
                    modified: meta.modified().ok().map(DateTime::<Utc>::from),
                });
            }
        }
        all.entry(marker.id).or_insert(Folder {
            files,
            references: marker.references,
        });
    }
    all
}

/// Links per session.
pub(super) fn linked(vault: &Path) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    for link in crate::items::links::list(vault, None, None).unwrap_or_default() {
        *counts.entry(link.session).or_insert(0) += 1;
    }
    counts
}

/// Note ids placed on the Board.
pub(super) fn on_board(vault: &Path) -> HashSet<String> {
    let Ok(bytes) = std::fs::read(vault.join(".coxinha/board.json")) else {
        return HashSet::new();
    };
    let Ok(board) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return HashSet::new();
    };
    board["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["noteId"].as_str().map(str::to_string))
        .collect()
}

pub(super) fn is_diagram(target: &str) -> bool {
    if crate::items::files::is_url(target) {
        let host = reqwest::Url::parse(target)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned));
        if host.is_some_and(|h| DIAGRAM_HOSTS.contains(&h.as_str())) {
            return true;
        }
    }
    let lower = target.to_lowercase();
    let path = lower.split(['?', '#']).next().unwrap_or_default();
    DIAGRAM_ENDINGS.iter().any(|ending| path.ends_with(ending))
}
