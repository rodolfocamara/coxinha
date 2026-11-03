//! Search shared by `Coxinha cli search` and the Reuniões search (spec 0107):
//! titles, people, notes and transcripts, with a snippet per matched field.
use super::{meetings, paths::Paths, Library};
use crate::calendar::Candidate;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Match {
    pub field: &'static str,
    pub snippet: String,
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
    pub notes: Option<&'a str>,
    pub transcript: Option<&'a str>,
}

/// Matched fields in a fixed order: title, people, notes, transcript.
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
        });
    }
    for (field, text) in [("notes", fields.notes), ("transcript", fields.transcript)] {
        if let Some(snippet) = text.and_then(|t| meetings::snippet(t, query, 160)) {
            found.push(Match { field, snippet });
        }
    }
    found
}

/// Sessions with at least one matched field, in the library's order.
pub fn search(paths: &Paths, query: &str, limit: usize) -> Result<Vec<Hit>, String> {
    let library = Library::open(paths)?;
    let mut hits = Vec::new();
    for (summary, session) in library.summaries(paths) {
        let notes = meetings::note_text(paths, session);
        let transcript = library
            .report(session)
            .map(|report| meetings::transcript(&report));
        let mut people = summary.participants.clone();
        people.extend(summary.organizer.clone());
        let found = matches(
            &Fields {
                title: &summary.title,
                people: &people,
                notes: notes.as_deref(),
                transcript: transcript.as_deref(),
            },
            query,
        );
        if !found.is_empty() {
            hits.push(Hit {
                id: summary.id,
                title: summary.title,
                starts_at: summary.starts_at,
                matches: found,
            });
        }
        if hits.len() >= limit {
            break;
        }
    }
    Ok(hits)
}
