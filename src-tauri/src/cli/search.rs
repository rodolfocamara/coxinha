//! Search shared by `Coxinha cli search` and the universal search (specs 0107,
//! 0122): titles, people, categories, notes and transcripts, with a snippet
//! per matched field.
use super::{meetings, paths::Paths, Library};
use crate::calendar::Candidate;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub field: &'static str,
    pub snippet: String,
    /// Spec 0122: where the matched transcript line starts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at_ms: Option<u64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub id: String,
    pub title: String,
    pub starts_at: Option<String>,
    pub matches: Vec<Match>,
}

/// What one meeting offers to the search.
pub struct Fields<'a> {
    pub title: &'a str,
    pub people: &'a [Candidate],
    pub categories: &'a [String],
    pub notes: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub transcript: Option<&'a str>,
}

/// Matched fields in a fixed order: title, people, category, notes, summary, transcript.
pub fn matches(fields: &Fields, query: &str) -> Vec<Match> {
    let needle = meetings::fold(query);
    if needle.is_empty() {
        return Vec::new();
    }
    let mut found = Vec::new();
    if let Some(snippet) = meetings::snippet(fields.title, query, 120) {
        found.push(Match {
            field: "title",
            snippet,
            at_ms: None,
        });
    }
    let people: Vec<&str> = fields
        .people
        .iter()
        .filter(|p| {
            meetings::fold(&p.name).contains(&needle)
                || p.email
                    .as_deref()
                    .is_some_and(|e| meetings::fold(e).contains(&needle))
        })
        .map(|p| p.name.as_str())
        .collect();
    if !people.is_empty() {
        found.push(Match {
            field: "people",
            snippet: people.join(", "),
            at_ms: None,
        });
    }
    let categories: Vec<&str> = fields
        .categories
        .iter()
        .filter(|c| meetings::fold(c).contains(&needle))
        .map(String::as_str)
        .collect();
    if !categories.is_empty() {
        found.push(Match {
            field: "category",
            snippet: categories.join(", "),
            at_ms: None,
        });
    }
    for (field, text) in [
        ("notes", fields.notes),
        ("summary", fields.summary),
        ("transcript", fields.transcript),
    ] {
        if let Some(snippet) = text.and_then(|t| meetings::snippet(t, query, 160)) {
            found.push(Match {
                field,
                snippet,
                at_ms: None,
            });
        }
    }
    found
}

/// Sessions with at least one matched field, in the library's order.
pub fn search(paths: &Paths, query: &str, limit: usize) -> Result<Vec<Hit>, String> {
    let library = Library::open(paths)?;
    let mut hits = Vec::new();
    scan(&library, paths, query, &|| false, |hit| {
        hits.push(hit);
        hits.len() < limit
    })?;
    Ok(hits)
}

/// Spec 0122 P3: 0 title starts with the query, 1 contains it, 2 people or
/// category, 3 notes or summary, 4 transcript only.
pub fn tier(hit: &Hit, query: &str) -> u8 {
    let needle = meetings::fold(query);
    hit.matches
        .iter()
        .map(|m| match m.field {
            "title" if meetings::fold(&hit.title).starts_with(&needle) => 0,
            "title" => 1,
            "people" | "category" => 2,
            "transcript" => 4,
            _ => 3,
        })
        .min()
        .unwrap_or(u8::MAX)
}

/// Every matching session, best tier first (library order inside a tier),
/// cut to `limit`. Empty when `stale` turns true mid-scan.
pub(crate) fn ranked(
    library: &Library,
    paths: &Paths,
    query: &str,
    limit: usize,
    stale: &dyn Fn() -> bool,
) -> Result<Vec<Hit>, String> {
    let mut hits = Vec::new();
    let finished = scan(library, paths, query, stale, |hit| {
        hits.push(hit);
        true
    })?;
    if !finished {
        return Ok(Vec::new());
    }
    hits.sort_by_key(|hit| tier(hit, query));
    hits.truncate(limit);
    Ok(hits)
}

/// Feeds matching sessions to `keep` until it declines; false when `stale` stopped it.
fn scan(
    library: &Library,
    paths: &Paths,
    query: &str,
    stale: &dyn Fn() -> bool,
    mut keep: impl FnMut(Hit) -> bool,
) -> Result<bool, String> {
    let needle = meetings::fold(query);
    for (summary, session) in library.summaries(paths) {
        if stale() {
            return Ok(false);
        }
        let notes = meetings::note_text(paths, session);
        let generated = library
            .generated_summary(session)
            .and_then(|v| v["markdown"].as_str().map(str::to_string));
        let report = library.report(session);
        let transcript = report.as_ref().map(meetings::transcript);
        let lines = report
            .as_ref()
            .map(coxinha_core::processing::named_lines)
            .unwrap_or_default();
        let mut people = summary.participants.clone();
        people.extend(summary.organizer.clone());
        let mut found = matches(
            &Fields {
                title: &summary.title,
                people: &people,
                categories: &summary.categories,
                notes: notes.as_deref(),
                summary: generated.as_deref(),
                transcript: transcript.as_deref(),
            },
            query,
        );
        if let Some(m) = found.iter_mut().find(|m| m.field == "transcript") {
            let said =
                |l: &coxinha_core::processing::NamedLine| format!("{}: {}", l.speaker, l.text);
            if let Some(line) = lines
                .iter()
                .find(|l| meetings::fold(&said(l)).contains(&needle))
            {
                m.at_ms = Some(line.start_ms);
                m.snippet = meetings::snippet(&said(line), query, 160).unwrap_or_default();
            }
        }
        if found.is_empty() {
            continue;
        }
        let hit = Hit {
            id: summary.id,
            title: summary.title,
            starts_at: summary.starts_at,
            matches: found,
        };
        if !keep(hit) {
            break;
        }
    }
    Ok(true)
}

/// Outlook events no session claimed, best tier first, cut to `limit`.
pub(crate) fn events(library: &Library, query: &str, limit: usize) -> Vec<Hit> {
    let claimed: Vec<&str> = meetings::match_events(&library.sessions, &library.events)
        .into_iter()
        .flatten()
        .map(|event| event.id.as_str())
        .collect();
    let mut hits: Vec<Hit> = library
        .events
        .iter()
        .filter(|event| !event.cancelled && !claimed.contains(&event.id.as_str()))
        .filter_map(|event| {
            let mut people = event.attendees.clone();
            people.extend(event.organizer.clone());
            let found = matches(
                &Fields {
                    title: &event.title,
                    people: &people,
                    categories: &event.categories,
                    notes: None,
                    summary: None,
                    transcript: None,
                },
                query,
            );
            (!found.is_empty()).then(|| Hit {
                id: event.id.clone(),
                title: event.title.clone(),
                starts_at: Some(event.starts_at.clone()),
                matches: found,
            })
        })
        .collect();
    hits.sort_by_key(|hit| tier(hit, query));
    hits.truncate(limit);
    hits
}
