use super::args::parse;
use super::meetings::{fold, match_events, snippet};
use super::*;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;

fn strings(raw: &[&str]) -> Vec<String> {
    raw.iter().map(|s| s.to_string()).collect()
}

pub(super) struct Fixture {
    _root: TempDir,
    pub(super) vault: String,
    pub(super) data: String,
}

impl Fixture {
    fn run(&self, raw: &[&str]) -> Result<Value, String> {
        let mut all = strings(raw);
        all.extend(strings(&["--vault", &self.vault, "--data", &self.data]));
        run(&all)
    }
}

fn event(id: &str, title: &str, start: &str, end: &str, categories: &[&str]) -> Value {
    json!({
        "id": id, "title": title, "startsAt": start, "endsAt": end, "cancelled": false,
        "allDay": false, "attendees": [{ "name": "Ana Souza", "email": "ana@x.com" }],
        "organizer": { "name": "Tiago", "email": "r@x.com" }, "categories": categories,
    })
}

/// A library with two sessions (one recorded and transcribed), an Outlook
/// cache, a vault index with an activity and a meeting note.
pub(super) fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let vault = root.path().join("vault");
    let data = root.path().join("data");
    let library = data.join("meeting-library");
    drop(coxinha_core::store::Store::open(&library).unwrap());
    let db = Connection::open(library.join("meetings.db")).unwrap();
    db.execute_batch(
        "INSERT INTO meeting(id,title,created_at,capture_state) VALUES('m1','Pulso','2026-11-03 13:00:00','finished');
         INSERT INTO session(id,title,starts_at,ends_at,status,origin,meeting_id,note_id,note_path)
           VALUES('s1','Project Atlas - App Alignment','2026-11-03T13:00:00Z','2026-11-03T14:00:00Z','completed','manual','m1','n-meet','notes/session-n-meet.md');
         INSERT INTO session(id,title,status,origin) VALUES('s2','Retro do time','planned','manual');
         INSERT INTO job(id,meeting_id,identity_key,stage,input_json,state) VALUES('j1','m1','k1','process','{}','succeeded');",
    )
    .unwrap();
    let result = json!({
        "segments": [
            { "id": "a", "track": "output", "start_ms": 65000, "end_ms": 70000, "text": "vamos decidir o backend", "speaker": "speaker-2" },
            { "id": "b", "track": "mic", "start_ms": 1000, "end_ms": 3000, "text": "bom dia", "speaker": null },
        ],
        "turns": [], "warnings": [],
    });
    db.execute(
        "INSERT INTO processing_run(job_id,config_json,result_json) VALUES('j1','{}',?1)",
        [result.to_string()],
    )
    .unwrap();
    db.execute(
        "INSERT INTO human_edit(meeting_id,target,body) VALUES('m1','j1:a','vamos decidir o backend do Digital 360')",
        [],
    )
    .unwrap();
    let profiles = Connection::open(library.join("private/profiles.db")).unwrap();
    profiles
        .execute_batch(
            "INSERT INTO person(id,name,aliases_json,consent_origin) VALUES('p1','Ana Souza','[]','test');
             INSERT INTO assignment(id,meeting_id,speaker,person_id,state,derived_generation) VALUES('as1','m1','j1:output:speaker-2','p1','confirmed',0);
             INSERT INTO participant_context(meeting_id,participants_json) VALUES('m1','[{\"name\":\"Bruno Lima\",\"email\":null}]');",
        )
        .unwrap();
    let cache = json!({
        "account": "me", "syncedAt": null, "categories": [],
        "events": [
            event("e1", "PROJECT ATLAS - App alignment", "2026-11-03T13:10:00Z", "2026-11-03T14:00:00Z", &["CTO"]),
            event("e2", "Other", "2026-11-03T13:00:00Z", "2026-11-03T13:30:00Z", &[]),
        ],
    });
    std::fs::write(data.join("outlook-cache.json"), cache.to_string()).unwrap();
    std::fs::create_dir_all(vault.join("notes")).unwrap();
    std::fs::write(
        vault.join("notes/session-n-meet.md"),
        "---\nid: n-meet\n---\n# Pauta\nDecidir quem faz o backend.\n",
    )
    .unwrap();
    std::fs::create_dir_all(vault.join(".coxinha")).unwrap();
    drop(crate::db::Db::open(&vault.join(".coxinha/index.db")).unwrap());
    let index = Connection::open(vault.join(".coxinha/index.db")).unwrap();
    index
        .execute_batch(
            "INSERT INTO notes(id,path,title,created_at,updated_at) VALUES
               ('n-act','notes/backend.md','Definir backend','2026-11-01','2026-11-02'),
               ('n-meet','notes/session-n-meet.md','My notes','2026-11-01','2026-11-01'),
               ('n-day','daily/2026-11-03.md','2026-11-03','2026-11-03','2026-11-03');",
        )
        .unwrap();
    std::fs::write(
        vault.join(".coxinha/board.json"),
        json!({ "version": 3, "revision": 1, "edges": [],
                "items": [{ "id": "c1", "kind": "card", "noteId": "n-act" }] })
        .to_string(),
    )
    .unwrap();
    Fixture {
        vault: vault.display().to_string(),
        data: data.display().to_string(),
        _root: root,
    }
}

#[test]
fn parses_commands_flags_and_switches() {
    let args = parse(&strings(&[
        "meetings",
        "--from",
        "2026-11-01",
        "--limit=5",
        "--no-transcript",
        "x",
    ]))
    .unwrap();
    assert_eq!(args.command, "meetings");
    assert_eq!(args.positional, vec!["x"]);
    assert_eq!(args.limit(50).unwrap(), 5);
    assert!(args.switch("no-transcript"));
    assert_eq!(
        args.date("from").unwrap().unwrap().to_string(),
        "2026-11-01"
    );
    assert!(parse(&strings(&["meetings", "--from"])).is_err());
    assert!(parse(&strings(&["meetings", "--limit", "0"]))
        .unwrap()
        .limit(5)
        .is_err());
    assert!(parse(&strings(&["meetings", "--to", "11/03"]))
        .unwrap()
        .date("to")
        .is_err());
    assert_eq!(parse(&[]).unwrap().command, "help");
}

#[test]
fn overrides_win_and_the_data_dir_follows_tauri() {
    let paths = paths::resolve(Some("/v"), Some("/d")).unwrap();
    assert_eq!(
        paths.meetings_db(),
        Path::new("/d/meeting-library/meetings.db")
    );
    assert_eq!(
        paths.profiles_db(),
        Path::new("/d/meeting-library/private/profiles.db")
    );
    assert_eq!(paths.index_db(), Path::new("/v/.coxinha/index.db"));
    let default = paths::resolve(Some("/v"), None).unwrap();
    assert!(default.data.ends_with(paths::IDENTIFIER));
}

#[test]
fn folds_accents_and_cuts_snippets_around_the_match() {
    assert_eq!(fold("  Reunião ÇÃO "), "reuniao cao");
    let text = "abc ".repeat(30) + "Decisão do backend " + &"xyz ".repeat(30);
    let cut = snippet(&text, "decisao", 30).unwrap();
    assert!(cut.contains("Decisão"), "{cut}");
    assert!(cut.starts_with('…') && cut.ends_with('…'));
    assert!(snippet("nada aqui", "backend", 30).is_none());
}

#[test]
fn matches_events_by_title_window_or_exact_times_once() {
    let f = fixture();
    let paths = paths::resolve(Some(&f.vault), Some(&f.data)).unwrap();
    let library = Library::open(&paths).unwrap();
    let matched = match_events(&library.sessions, &library.events);
    let ids: Vec<_> = matched.iter().map(|e| e.map(|e| e.id.as_str())).collect();
    // s1 matches e1 by title within 30 minutes; s2 has no start.
    assert_eq!(ids, vec![Some("e1"), None]);
}

#[test]
fn lists_meetings_with_participants_categories_and_filters() {
    let f = fixture();
    let all = f.run(&["meetings"]).unwrap();
    assert_eq!(all["count"], 2);
    let first = &all["meetings"][0];
    assert_eq!(first["id"], "s1");
    assert_eq!(first["categories"], json!(["CTO"]));
    let names: Vec<_> = first["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Ana Souza", "Bruno Lima"]);
    assert_eq!(
        f.run(&["meetings", "--category", "cto"]).unwrap()["count"],
        1
    );
    assert_eq!(
        f.run(&["meetings", "--person", "bruno"]).unwrap()["count"],
        1
    );
    assert_eq!(
        f.run(&["meetings", "--query", "retro"]).unwrap()["count"],
        1
    );
    assert_eq!(
        f.run(&["meetings", "--from", "2026-11-04"]).unwrap()["count"],
        0
    );
}

#[test]
fn shows_notes_and_a_named_corrected_transcript() {
    let f = fixture();
    let detail = f.run(&["meeting", "s1"]).unwrap();
    assert_eq!(detail["notes"], "# Pauta\nDecidir quem faz o backend.");
    assert_eq!(
        detail["transcript"],
        "[00:01] mic: bom dia\n[01:05] Ana Souza: vamos decidir o backend do Digital 360"
    );
    let short = f.run(&["meeting", "s1", "--no-transcript"]).unwrap();
    assert!(short["transcript"].is_null());
    assert_eq!(short["hasTranscript"], true);
    assert!(f.run(&["meeting", "nope"]).is_err());
}

#[test]
fn searches_titles_notes_and_transcripts() {
    let f = fixture();
    let found = f.run(&["search", "backend"]).unwrap();
    assert_eq!(found["count"], 1);
    let fields: Vec<_> = found["results"][0]["matches"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields, vec!["notes", "transcript"]);
    assert_eq!(
        f.run(&["search", "retro"]).unwrap()["results"][0]["id"],
        "s2"
    );
}

#[test]
fn search_matches_people_and_serves_the_app_with_explicit_paths() {
    let f = fixture();
    let people = f.run(&["search", "bruno"]).unwrap();
    assert_eq!(people["results"][0]["id"], "s1");
    assert_eq!(people["results"][0]["matches"][0]["field"], "people");
    assert_eq!(people["results"][0]["matches"][0]["snippet"], "Bruno Lima");

    // `universal_search` resolves these from the running app instead of flags.
    let paths = paths::Paths {
        vault: f.vault.clone().into(),
        data: f.data.clone().into(),
    };
    let hits = search::search(&paths, "digital 360", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "s1");
    assert_eq!(hits[0].matches[0].field, "transcript");
    assert!(hits[0].matches[0].snippet.contains("Digital 360"));
    assert!(search::search(&paths, "   ", 10).unwrap().is_empty());
    assert_eq!(search::search(&paths, "a", 1).unwrap().len(), 1);
}

#[test]
fn search_fields_come_in_a_fixed_order() {
    let people = [crate::calendar::Candidate {
        name: "Rosana Costa".into(),
        email: Some("rosana@x.com".into()),
    }];
    let found = search::matches(
        &search::Fields {
            title: "Headcount Q1",
            people: &people,
            categories: &[],
            notes: Some("headcount aprovado"),
            summary: None,
            transcript: Some("[00:10] Rosana: o headcount"),
        },
        "headcount",
    );
    let fields: Vec<_> = found.iter().map(|m| m.field).collect();
    assert_eq!(fields, vec!["title", "notes", "transcript"]);
    let by_email = search::matches(
        &search::Fields {
            title: "x",
            people: &people,
            categories: &[],
            notes: None,
            summary: None,
            transcript: None,
        },
        "ROSANA@",
    );
    assert_eq!(by_email[0].snippet, "Rosana Costa");
}

#[test]
fn lists_activities_without_meeting_or_daily_notes() {
    let f = fixture();
    let found = f.run(&["activities"]).unwrap();
    assert_eq!(found["count"], 1);
    assert_eq!(found["activities"][0]["id"], "n-act");
    assert_eq!(found["activities"][0]["onBoard"], true);
}

#[test]
fn writes_files_references_and_links_through_item_rules() {
    let f = fixture();
    let outside = tempfile::tempdir().unwrap();
    let deck = outside.path().join("deck.html");
    std::fs::write(&deck, "<h1>x</h1>").unwrap();
    let deck = deck.display().to_string();

    let added = f.run(&["add-file", "meeting", "s1", &deck]).unwrap();
    assert!(added["folder"]
        .as_str()
        .unwrap()
        .ends_with("meetings/2026-11-03 Project Atlas - App Alignment"));
    assert_eq!(added["files"][0]["name"], "deck.html");
    let again = f.run(&["add-file", "meeting", "s1", &deck]).unwrap();
    assert_eq!(again["files"].as_array().unwrap().len(), 2);

    let referenced = f
        .run(&[
            "add-ref",
            "activity",
            "n-act",
            "https://example.com/deck",
            "--label",
            "Deck",
        ])
        .unwrap();
    assert!(referenced["folder"]
        .as_str()
        .unwrap()
        .ends_with("activities/Definir backend"));
    assert_eq!(referenced["references"][0]["label"], "Deck");

    let linked = f.run(&["link", "s1", "n-act"]).unwrap();
    assert_eq!(linked["links"].as_array().unwrap().len(), 1);
    let detail = f.run(&["meeting", "s1", "--no-transcript"]).unwrap();
    assert_eq!(detail["activities"][0]["title"], "Definir backend");
    assert!(
        f.run(&["link", "s1", "n-meet"]).is_err(),
        "meeting notes are not activities"
    );
    assert!(f.run(&["link", "nope", "n-act"]).is_err());
    assert!(f
        .run(&["add-file", "meeting", "s1", "/no/such/file"])
        .is_err());
    assert!(f.run(&["add-file", "task", "s1", &deck]).is_err());
    let unlinked = f.run(&["unlink", "s1", "n-act"]).unwrap();
    assert!(unlinked["links"].as_array().unwrap().is_empty());
}

#[test]
fn unknown_commands_and_missing_arguments_fail() {
    let f = fixture();
    assert!(f.run(&["frobnicate"]).is_err());
    assert!(f.run(&["meeting"]).is_err());
    assert!(f.run(&["search"]).is_err());
    assert!(run(&strings(&["help"])).unwrap()["usage"]
        .as_str()
        .unwrap()
        .contains("add-ref"));
}

#[test]
fn shows_and_searches_the_generated_summary() {
    let f = fixture();
    assert!(f.run(&["meeting", "s1"]).unwrap()["summary"].is_null());
    let db = Connection::open(std::path::Path::new(&f.data).join("meeting-library/meetings.db"))
        .unwrap();
    db.execute(
        "INSERT INTO meeting_summary(meeting_id,job_id,markdown,model,generated_at,source_sha256)
         VALUES('m1','j1','## Resumo\nAna assume o orçamento.','qwen','2026-11-03T15:00:00Z','h')",
        [],
    )
    .unwrap();
    let detail = f.run(&["meeting", "s1", "--no-transcript"]).unwrap();
    assert_eq!(
        detail["summary"],
        json!({ "markdown": "## Resumo\nAna assume o orçamento.", "generatedAt": "2026-11-03T15:00:00Z" })
    );
    let found = f.run(&["search", "orcamento"]).unwrap();
    assert_eq!(found["results"][0]["matches"][0]["field"], "summary");
}
