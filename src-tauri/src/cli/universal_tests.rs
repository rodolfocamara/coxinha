use super::super::tests::fixture;
use super::super::Library;
use super::*;
use rusqlite::Connection;
use std::cell::Cell;

fn paths_of(vault: &str, data: &str) -> Paths {
    Paths {
        vault: vault.into(),
        data: data.into(),
    }
}

fn index_notes(paths: &Paths, notes: &[(&str, &str, &str, &str)]) {
    let index = Connection::open(paths.index_db()).unwrap();
    for (id, path, title, body) in notes {
        index
            .execute(
                "INSERT OR REPLACE INTO notes(id,path,title,created_at,updated_at) VALUES(?1,?2,?3,'2026-11-01','2026-11-01')",
                params![id, path, title],
            )
            .unwrap();
        index
            .execute(
                "INSERT INTO notes_fts(id,title,body) VALUES(?1,?2,?3)",
                params![id, title, body],
            )
            .unwrap();
    }
}

#[test]
fn notes_rank_titles_first_and_respect_the_limit() {
    let f = fixture();
    let paths = paths_of(&f.vault, &f.data);
    index_notes(
        &paths,
        &[
            (
                "n-body",
                "notes/plan.md",
                "Plano do trimestre",
                "o backend novo sai em dezembro",
            ),
            ("n-act", "notes/backend.md", "Definir backend", "quem faz"),
            (
                "n-mid",
                "notes/arch.md",
                "Arquitetura do Backend",
                "camadas",
            ),
            (
                "n-meet",
                "notes/session-n-meet.md",
                "My notes",
                "Decidir quem faz o backend.",
            ),
        ],
    );
    let hits = notes(&paths, "back", 10).unwrap();
    let ids: Vec<_> = hits.iter().map(|h| (h.id.as_str(), h.tier)).collect();
    assert_eq!(ids, vec![("n-act", 1), ("n-mid", 1), ("n-body", 3)]);
    // Board cards are activities; body hits carry their snippet.
    assert!(hits[0].activity);
    assert!(!hits[1].activity);
    assert_eq!(hits[0].snippet, None);
    assert!(hits[2].snippet.as_deref().unwrap().contains("backend novo"));
    // Accents and case fold; word prefixes; the limit bounds the answer.
    assert_eq!(notes(&paths, "ARQUI", 10).unwrap()[0].id, "n-mid");
    assert_eq!(notes(&paths, "back", 1).unwrap().len(), 1);
    assert!(notes(&paths, " \" ", 10).unwrap().is_empty());
}

#[test]
fn meetings_rank_by_field_and_transcript_has_time() {
    let f = fixture();
    let paths = paths_of(&f.vault, &f.data);
    let db = Connection::open(paths.meetings_db()).unwrap();
    db.execute_batch(
        "INSERT INTO session(id,title,starts_at,status,origin) VALUES('s3','Backend sync','2026-10-01T10:00:00Z','planned','manual');",
    )
    .unwrap();
    let library = Library::open(&paths).unwrap();
    let ranked = |q: &str, limit| search::ranked(&library, &paths, q, limit, &|| false).unwrap();
    // s3 by title, s1 by its notes ("Decidir quem faz o backend") and transcript.
    let hits = ranked("backend", 10);
    let ids: Vec<_> = hits.iter().map(|h| h.id.as_str()).collect();
    assert_eq!(ids, vec!["s3", "s1"]);
    assert_eq!(search::tier(&hits[0], "backend"), 0);
    assert_eq!(search::tier(&hits[1], "backend"), 3);

    let digital = ranked("digital 360", 10);
    let transcript = &digital[0].matches[0];
    assert_eq!(transcript.field, "transcript");
    assert_eq!(transcript.at_ms, Some(65_000));
    assert!(transcript.snippet.contains("Digital 360"));
    assert_eq!(search::tier(&digital[0], "digital 360"), 4);

    // People and categories rank above notes; the limit keeps the best.
    assert_eq!(search::tier(&ranked("bruno", 10)[0], "bruno"), 2);
    assert_eq!(ranked("cto", 10)[0].matches[0].field, "category");
    assert_eq!(ranked("backend", 1)[0].id, "s3");
}

#[test]
fn events_without_a_session_match_on_the_cache() {
    let f = fixture();
    let paths = paths_of(&f.vault, &f.data);
    let library = Library::open(&paths).unwrap();
    // e1 belongs to session s1, so only e2 answers.
    assert!(search::events(&library, "pulso", 10).is_empty());
    let other = search::events(&library, "other", 10);
    assert_eq!(other[0].id, "e2");
    assert_eq!(other[0].starts_at.as_deref(), Some("2026-11-03T13:00:00Z"));
    let people = search::events(&library, "rodolfo", 10);
    assert_eq!(search::tier(&people[0], "rodolfo"), 2);
    assert!(search::events(&library, "rodolfo", 0).is_empty());
}

#[test]
fn people_match_names_and_aliases() {
    let f = fixture();
    let paths = paths_of(&f.vault, &f.data);
    let profiles = Connection::open(paths.profiles_db()).unwrap();
    profiles
        .execute_batch(
            "INSERT INTO person(id,name,aliases_json,consent_origin) VALUES
               ('p2','Mariana Souto','[\"Mari\"]','test'),
               ('p3','Joana Mariano','[]','test'),
               ('p4','Pedro Alves','[\"Marinho\"]','test');",
        )
        .unwrap();
    let hits = people(&paths, "mari", 10).unwrap();
    let found: Vec<_> = hits
        .iter()
        .map(|h| (h.id.as_str(), h.tier, h.alias.as_deref()))
        .collect();
    assert_eq!(
        found,
        vec![("p2", 0, None), ("p3", 1, None), ("p4", 2, Some("Marinho"))]
    );
    assert_eq!(people(&paths, "SOUZA", 10).unwrap()[0].id, "p1");
    assert_eq!(people(&paths, "mari", 2).unwrap().len(), 2);
}

#[test]
fn a_newer_query_stops_the_scan() {
    let f = fixture();
    let paths = paths_of(&f.vault, &f.data);
    let calls = Cell::new(0);
    let stale = || {
        calls.set(calls.get() + 1);
        calls.get() > 1
    };
    let answer = universal(&paths, "pulso", 10, &stale).unwrap();
    assert!(answer.meetings.is_empty() && answer.notes.is_empty() && answer.people.is_empty());
    let fresh = universal(&paths, "pulso", 10, &|| false).unwrap();
    assert_eq!(fresh.meetings[0].id, "s1");
    assert!(universal(&paths, "  ", 10, &|| false)
        .unwrap()
        .meetings
        .is_empty());
}
