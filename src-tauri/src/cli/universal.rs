//! Universal search (spec 0122): notes, meetings and people in one answer.
use super::{data, meetings, paths::Paths, search, Library};
use rusqlite::params;
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteHit {
    pub id: String,
    pub title: String,
    /// Body text around the match, when the title did not match.
    pub snippet: Option<String>,
    pub tier: u8,
    pub activity: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersonHit {
    pub id: String,
    pub name: String,
    /// The alias that matched when the name did not.
    pub alias: Option<String>,
    pub tier: u8,
}

#[derive(Serialize, Debug, Default)]
pub struct Answer {
    pub notes: Vec<NoteHit>,
    pub meetings: Vec<search::Hit>,
    /// Outlook events without a session of their own.
    pub events: Vec<search::Hit>,
    pub people: Vec<PersonHit>,
}

/// 0 when `text` starts with the folded needle, 1 when it contains it.
fn text_tier(text: &str, needle: &str) -> Option<u8> {
    let folded = meetings::fold(text);
    if folded.starts_with(needle) {
        Some(0)
    } else if folded.contains(needle) {
        Some(1)
    } else {
        None
    }
}

/// Every word as an FTS5 prefix phrase, so "back" finds "backend".
fn fts_query(query: &str) -> Option<String> {
    let words: Vec<String> = query
        .split_whitespace()
        .map(|w| w.replace('"', ""))
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
}

/// Answers all kinds, each cut to `limit`; empty once `stale` turns true.
pub fn universal(
    paths: &Paths,
    query: &str,
    limit: usize,
    stale: &dyn Fn() -> bool,
) -> Result<Answer, String> {
    if meetings::fold(query).is_empty() {
        return Ok(Answer::default());
    }
    let notes = notes(paths, query, limit).unwrap_or_default();
    if stale() {
        return Ok(Answer::default());
    }
    let people = people(paths, query, limit).unwrap_or_default();
    // No meeting library yet still answers notes and people.
    let (meetings, events) = match Library::open(paths) {
        Ok(library) => (
            search::ranked(&library, paths, query, limit, stale)?,
            search::events(&library, query, limit),
        ),
        Err(_) => Default::default(),
    };
    if stale() {
        return Ok(Answer::default());
    }
    Ok(Answer {
        notes,
        meetings,
        events,
        people,
    })
}

/// Index hits by BM25 with titles weighted, title matches first; meeting
/// notes belong to their meeting.
pub fn notes(paths: &Paths, query: &str, limit: usize) -> Result<Vec<NoteHit>, String> {
    let Some(fts) = fts_query(query) else {
        return Ok(Vec::new());
    };
    let needle = meetings::fold(query);
    let cards = data::board_cards(paths);
    let db = data::open_read_only(&paths.index_db())?;
    let mut q = db
        .prepare(
            "SELECT n.id, n.title, snippet(notes_fts, 2, '', '', '…', 16)
             FROM notes_fts f JOIN notes n ON n.id = f.id
             WHERE notes_fts MATCH ?1 AND n.path NOT LIKE 'notes/session-%'
             ORDER BY bm25(notes_fts, 0.0, 10.0, 1.0)
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map(params![fts, (limit * 3) as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for row in rows {
        let (id, title, snippet) = row.map_err(|e| e.to_string())?;
        let title_tier = text_tier(&title, &needle);
        hits.push(NoteHit {
            activity: cards.contains(&id),
            snippet: title_tier
                .is_none()
                .then(|| snippet.split_whitespace().collect::<Vec<_>>().join(" ")),
            tier: title_tier.unwrap_or(3),
            id,
            title,
        });
    }
    hits.sort_by_key(|hit| hit.tier);
    hits.truncate(limit);
    Ok(hits)
}

/// The people registry by name, then by alias (tier 2).
pub fn people(paths: &Paths, query: &str, limit: usize) -> Result<Vec<PersonHit>, String> {
    let needle = meetings::fold(query);
    let db = data::open_read_only(&paths.profiles_db())?;
    let mut q = db
        .prepare("SELECT id, name, aliases_json FROM person ORDER BY name, id")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for row in rows {
        let (id, name, aliases) = row.map_err(|e| e.to_string())?;
        let hit = match text_tier(&name, &needle) {
            Some(tier) => Some((tier, None)),
            None => serde_json::from_str::<Vec<String>>(&aliases)
                .unwrap_or_default()
                .into_iter()
                .find(|alias| meetings::fold(alias).contains(&needle))
                .map(|alias| (2, Some(alias))),
        };
        if let Some((tier, alias)) = hit {
            hits.push(PersonHit {
                id,
                name,
                alias,
                tier,
            });
        }
    }
    hits.sort_by_key(|hit| hit.tier);
    hits.truncate(limit);
    Ok(hits)
}

#[cfg(test)]
#[path = "universal_tests.rs"]
mod tests;
