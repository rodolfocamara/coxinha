use super::*;
use rusqlite::Connection;
use serde_json::json;
use std::time::{Duration, SystemTime};
use tempfile::TempDir;

const START: &str = "2026-11-03T13:00:00Z";

struct Fixture {
    _root: TempDir,
    paths: Paths,
    db: Connection,
    profiles: Connection,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let paths = Paths {
        vault: root.path().join("vault"),
        data: root.path().join("data"),
    };
    std::fs::create_dir_all(paths.vault.join("notes")).unwrap();
    std::fs::create_dir_all(paths.vault.join(".coxinha")).unwrap();
    drop(coxinha_core::store::Store::open(paths.library()).unwrap());
    let db = Connection::open(paths.meetings_db()).unwrap();
    let profiles = Connection::open(paths.profiles_db()).unwrap();
    Fixture {
        _root: root,
        paths,
        db,
        profiles,
    }
}

fn ago(hours_before_start: i64) -> SystemTime {
    let start = instant(START).unwrap() - chrono::Duration::hours(hours_before_start);
    SystemTime::UNIX_EPOCH + Duration::from_secs(start.timestamp() as u64)
}

impl Fixture {
    fn session(&self, id: &str, start: Option<&str>) {
        self.db
            .execute(
                "INSERT INTO session(id,title,starts_at,status,origin) VALUES(?1,?1,?2,'planned','manual')",
                rusqlite::params![id, start],
            )
            .unwrap();
    }

    /// A session with a meeting and a finished run; the job id is unique
    /// because finished runs are remembered per process.
    fn recorded(&self, id: &str, result: serde_json::Value) -> String {
        let meeting = format!("m-{id}");
        let job = uuid::Uuid::new_v4().to_string();
        self.db
            .execute(
                "INSERT INTO meeting(id,title,created_at,capture_state) VALUES(?1,'t','2026-11-03 13:00:00','finished')",
                [&meeting],
            )
            .unwrap();
        self.db
            .execute(
                "INSERT INTO session(id,title,starts_at,status,origin,meeting_id) VALUES(?1,?1,?2,'completed','manual',?3)",
                rusqlite::params![id, START, meeting],
            )
            .unwrap();
        self.db
            .execute(
                "INSERT INTO job(id,meeting_id,identity_key,stage,input_json,state) VALUES(?1,?2,?1,'process','{}','succeeded')",
                [&job, &meeting],
            )
            .unwrap();
        self.db
            .execute(
                "INSERT INTO processing_run(job_id,config_json,result_json) VALUES(?1,'{}',?2)",
                [&job, &result.to_string()],
            )
            .unwrap();
        job
    }

    fn note(&self, session: &str, body: &str, modified: SystemTime) {
        let relative = format!("notes/session-{session}.md");
        let path = self.paths.vault.join(&relative);
        std::fs::write(&path, format!("---\nid: {session}\n---\n{body}")).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        self.db
            .execute(
                "UPDATE session SET note_id=?1, note_path=?2 WHERE id=?1",
                [session, &relative],
            )
            .unwrap();
    }

    fn folder(&self, session: &str, references: serde_json::Value) -> std::path::PathBuf {
        let dir = self.paths.vault.join("meetings").join(session);
        std::fs::create_dir_all(&dir).unwrap();
        let marker =
            json!({ "version": 1, "kind": "meeting", "id": session, "references": references });
        std::fs::write(dir.join(crate::items::folder::MARKER), marker.to_string()).unwrap();
        dir
    }

    fn file(&self, session: &str, name: &str, modified: SystemTime) {
        let path = self.folder(session, json!([])).join(name);
        std::fs::write(&path, "x").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(modified)
            .unwrap();
    }

    fn of(&self, session: &str) -> MeetingSignals {
        collect(&self.paths)
            .unwrap()
            .into_iter()
            .find(|s| s.session_id == session)
            .unwrap()
    }
}

fn result_with_speakers() -> serde_json::Value {
    json!({
        "segments": [
            { "id": "a", "track": "output", "start_ms": 0, "end_ms": 900, "text": "bom dia", "speaker": "speaker-1" },
        ],
        "turns": [
            { "id": "t1", "track": "output", "start_ms": 0, "end_ms": 900, "speaker": "speaker-1" },
            { "id": "t2", "track": "output", "start_ms": 900, "end_ms": 1800, "speaker": "speaker-2" },
            { "id": "t3", "track": "mic", "start_ms": 0, "end_ms": 900, "speaker": "speaker-1" },
            { "id": "t4", "track": "output", "start_ms": 1, "end_ms": 2, "speaker": "unknown" },
        ],
        "warnings": [],
    })
}

#[test]
fn a_session_with_nothing_has_no_signals() {
    let f = fixture();
    f.session("empty", Some(START));
    let empty = f.of("empty");
    assert_eq!(
        empty,
        MeetingSignals {
            session_id: "empty".into(),
            ..MeetingSignals::default()
        }
    );
}

#[test]
fn transcript_and_speakers_follow_the_latest_run_and_the_named_voices() {
    let f = fixture();
    let job = f.recorded("r", result_with_speakers());
    f.profiles
        .execute_batch(&format!(
            "INSERT INTO person(id,name,aliases_json,consent_origin) VALUES('p1','Ana','[]','test');
             INSERT INTO assignment(id,meeting_id,speaker,person_id,state,derived_generation) VALUES('a1','m-r','{job}:output:speaker-1','p1','confirmed',0);
             INSERT INTO assignment(id,meeting_id,speaker,person_id,state,derived_generation) VALUES('a2','m-r','{job}:mic:speaker-1','p1','suggested',0);",
        ))
        .unwrap();
    let signals = f.of("r");
    assert!(signals.transcript);
    assert_eq!(
        signals.speakers,
        SpeakerCounts {
            named: 1,
            unnamed: 2
        }
    );
    // A transcript alone is not content the meeting generated.
    assert!(!signals.generated_content);
}

#[test]
fn silent_or_broken_results_are_not_a_transcript() {
    let f = fixture();
    f.recorded(
        "silent",
        json!({ "segments": [{ "id": "a", "track": "mic", "start_ms": 0, "end_ms": 1, "text": "  ", "speaker": null }], "turns": [], "warnings": [] }),
    );
    f.recorded("broken", json!({ "unexpected": true }));
    assert!(!f.of("silent").transcript);
    assert!(!f.of("broken").transcript);
    assert_eq!(f.of("broken").speakers, SpeakerCounts::default());
}

#[test]
fn a_blank_note_is_no_note_and_a_filled_one_generates_content() {
    let f = fixture();
    f.session("blank", Some(START));
    f.note("blank", "*\n\n- ", ago(5));
    f.session("filled", Some(START));
    f.note("filled", "Pauta: roadmap", ago(5));
    assert!(!f.of("blank").note && !f.of("blank").preparation);
    let filled = f.of("filled");
    assert!(filled.note && filled.preparation && filled.generated_content);
}

#[test]
fn preparation_needs_evidence_from_before_the_start() {
    let f = fixture();
    // Edited after the start: there is no way to tell what was there before.
    f.session("late-note", Some(START));
    f.note("late-note", "Pauta", ago(-1));
    let late = f.of("late-note");
    assert!(late.note && !late.preparation);

    f.session("no-start", None);
    f.note("no-start", "Pauta", ago(5));
    assert!(!f.of("no-start").preparation);

    f.session("early-file", Some(START));
    f.file("early-file", "deck.pdf", ago(2));
    assert!(f.of("early-file").preparation);

    f.session("late-file", Some(START));
    f.file("late-file", "deck.pdf", ago(-2));
    assert!(!f.of("late-file").preparation);

    let reference =
        |at: &str| json!([{ "target": "https://example.test/doc", "label": null, "addedAt": at }]);
    f.session("early-ref", Some(START));
    f.folder("early-ref", reference("2026-11-03T12:00:00Z"));
    assert!(f.of("early-ref").preparation);
    f.session("late-ref", Some(START));
    f.folder("late-ref", reference("2026-11-03T14:00:00Z"));
    assert!(!f.of("late-ref").preparation);
    f.session("bad-ref", Some(START));
    f.folder("bad-ref", reference("yesterday"));
    assert!(!f.of("bad-ref").preparation);
}

#[test]
fn a_linked_activity_is_a_follow_up_not_preparation() {
    let f = fixture();
    f.session("s", Some(START));
    crate::items::links::add(&f.paths.vault, "s", "activity-1").unwrap();
    crate::items::links::add(&f.paths.vault, "s", "activity-2").unwrap();
    let signals = f.of("s");
    assert_eq!(
        signals.follow_ups,
        FollowUps {
            linked: 2,
            actions: 0
        }
    );
    assert!(signals.generated_content && !signals.preparation);
}

#[test]
fn a_summary_is_memory_and_its_actions_are_follow_ups() {
    let f = fixture();
    f.recorded("r", result_with_speakers());
    assert!(!f.of("r").summary);
    f.db.execute(
        "INSERT INTO meeting_summary(meeting_id,job_id,markdown,model,generated_at,source_sha256)
         VALUES('m-r','j','## Resumo\nTexto\n## Ações\n- Enviar o deck\n- Revisar\n## Pendências\n- Nenhuma','m','now','h')",
        [],
    )
    .unwrap();
    let signals = f.of("r");
    assert!(signals.summary && signals.generated_content);
    assert_eq!(
        signals.follow_ups,
        FollowUps {
            linked: 0,
            actions: 2
        }
    );
}

#[test]
fn a_library_without_the_summary_table_has_no_summaries() {
    let f = fixture();
    f.session("s", Some(START));
    f.db.execute_batch("DROP TABLE meeting_summary").unwrap();
    assert!(!f.of("s").summary);
}

#[test]
fn diagrams_are_files_or_references_or_the_note_on_the_board() {
    assert!(sources::is_diagram("clickhouse-vs-starrocks.excalidraw"));
    assert!(sources::is_diagram("Flow.DRAWIO"));
    assert!(sources::is_diagram("/home/x/flow.mmd"));
    assert!(sources::is_diagram("https://excalidraw.com/#json=abc,def"));
    assert!(sources::is_diagram(
        "https://example.test/flow.excalidraw?x=1"
    ));
    assert!(!sources::is_diagram("notes.md"));
    assert!(!sources::is_diagram("https://evil.test/?u=excalidraw.com"));

    let f = fixture();
    f.session("with-file", Some(START));
    f.file("with-file", "a.excalidraw", ago(-1));
    assert!(f.of("with-file").diagram);
    assert!(f.of("with-file").generated_content);
    f.session("with-md", Some(START));
    f.file("with-md", "a.md", ago(-1));
    assert!(!f.of("with-md").diagram);
    f.session("with-ref", Some(START));
    f.folder(
        "with-ref",
        json!([{ "target": "/x/flow.drawio", "label": null, "addedAt": START }]),
    );
    assert!(f.of("with-ref").diagram);

    f.session("placed", Some(START));
    f.note("placed", "", ago(-1));
    f.session("unplaced", Some(START));
    f.note("unplaced", "", ago(-1));
    std::fs::write(
        f.paths.vault.join(".coxinha/board.json"),
        json!({ "items": [{ "kind": "text", "noteId": "placed" }, { "kind": "area" }] })
            .to_string(),
    )
    .unwrap();
    assert!(f.of("placed").diagram);
    assert!(!f.of("unplaced").diagram);
}

#[test]
fn the_mark_is_only_what_the_owner_set() {
    let f = fixture();
    f.session("s", Some(START));
    f.note("s", "Pauta", ago(1));
    assert_eq!(f.of("s").mark, None);
    assert!(f.of("s").generated_content);
    marks::set(&f.paths.data, "s", Some(Mark::NotUseful)).unwrap();
    assert_eq!(f.of("s").mark, Some(Mark::NotUseful));
    marks::set(&f.paths.data, "s", None).unwrap();
    assert_eq!(f.of("s").mark, None);
}

#[test]
fn reads_are_bounded() {
    let f = fixture();
    // Only the head of a note is read.
    f.session("huge", Some(START));
    f.note("huge", &format!("{}letters", "-".repeat(70 * 1024)), ago(1));
    assert!(!f.of("huge").note);

    let tx = f.db.unchecked_transaction().unwrap();
    for n in 0..MAX_SESSIONS + 5 {
        tx.execute(
            "INSERT INTO session(id,title,status,origin) VALUES(?1,?1,'planned','manual')",
            [format!("bulk-{n}")],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    assert_eq!(collect(&f.paths).unwrap().len(), MAX_SESSIONS);
}

#[test]
fn a_finished_run_is_parsed_once() {
    let f = fixture();
    let job = f.recorded("r", result_with_speakers());
    assert!(f.of("r").transcript);
    f.db.execute(
        "UPDATE processing_run SET result_json='{}' WHERE job_id=?1",
        [&job],
    )
    .unwrap();
    assert!(f.of("r").transcript);
}
