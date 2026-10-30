use super::*;

#[test]
fn slug_lowercases_and_hyphenates() {
    assert_eq!(slug("Hello World"), "hello-world");
    assert_eq!(slug("  spaced   out  "), "spaced-out");
    assert_eq!(slug("Daily Notes / 2026-04-18"), "daily-notes-2026-04-18");
}

#[test]
fn slug_falls_back_when_empty() {
    assert_eq!(slug(""), "note");
    assert_eq!(slug("!!!"), "note");
    assert_eq!(slug("   "), "note");
}

#[test]
fn slug_truncates_long_titles() {
    let long = "a".repeat(200);
    assert!(slug(&long).len() <= 60);
}

#[test]
fn extract_tags_finds_alpha_hashtags() {
    let tags = extract_tags("meeting #work and #personal notes");
    assert_eq!(tags, vec!["work", "personal"]);
}

#[test]
fn extract_tags_deduplicates_preserving_order() {
    let tags = extract_tags("#alpha #beta #alpha #gamma");
    assert_eq!(tags, vec!["alpha", "beta", "gamma"]);
}

#[test]
fn extract_tags_rejects_numeric_and_empty() {
    let tags = extract_tags("#123 #_foo # #real");
    assert_eq!(tags, vec!["real"]);
}

#[test]
fn first_heading_reads_h1_and_h2() {
    assert_eq!(first_heading("# Title\n\nbody").as_deref(), Some("Title"));
    assert_eq!(
        first_heading("## Subsection\n").as_deref(),
        Some("Subsection")
    );
}

#[test]
fn extract_wikilinks_finds_plain_targets() {
    let md = "Link to [[Daily Notes]] and [[Projects]].";
    assert_eq!(
        extract_wikilinks(md),
        vec!["Daily Notes".to_string(), "Projects".to_string()]
    );
}

#[test]
fn extract_wikilinks_strips_aliases() {
    let md = "See [[Daily Notes|today]] or [[People/Alice|Alice]].";
    assert_eq!(
        extract_wikilinks(md),
        vec!["Daily Notes".to_string(), "People/Alice".to_string()]
    );
}

#[test]
fn extract_wikilinks_ignores_malformed_and_empty() {
    let md = "[[ empty:   ]][[]][[unclosed\n[[good]] [[across\nlines]]";
    let out = extract_wikilinks(md);
    // `[[ empty:   ]]` trims to "empty:" → kept.
    // `[[]]` is empty → dropped.
    // `[[unclosed` has no closer on the same line → dropped.
    // `[[across\nlines]]` has a newline → dropped.
    assert_eq!(out, vec!["empty:".to_string(), "good".to_string()]);
}

#[test]
fn extract_wikilinks_handles_adjacent_and_nested() {
    let md = "[[A]][[B]] and text then [[C]].";
    assert_eq!(
        extract_wikilinks(md),
        vec!["A".to_string(), "B".to_string(), "C".to_string()]
    );
}

#[test]
fn extract_wikilinks_tolerates_unicode_targets() {
    let md = "[[Reunião semanal]] e [[coração]]";
    assert_eq!(
        extract_wikilinks(md),
        vec!["Reunião semanal".to_string(), "coração".to_string()]
    );
}

#[test]
fn path_stem_returns_filename_without_extension() {
    assert_eq!(
        path_stem("notes/my-note-abc123.md"),
        Some("my-note-abc123".to_string())
    );
    assert_eq!(
        path_stem("daily/2026-04-19.md"),
        Some("2026-04-19".to_string())
    );
    assert_eq!(path_stem(""), None);
}

#[test]
fn first_heading_returns_none_without_heading() {
    assert_eq!(first_heading("plain paragraph"), None);
    assert_eq!(first_heading(""), None);
}

#[test]
fn sanitize_keeps_safe_chars_only() {
    assert_eq!(sanitize("file name.png"), "file_name.png");
    assert_eq!(sanitize("weird/name:with*chars"), "weird_name_with_chars");
    assert_eq!(sanitize("kept-1_2.ext"), "kept-1_2.ext");
}

// --- Integration: Storage against a temp vault + fresh DB ---

async fn fresh_storage() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().expect("tempdir");
    for sub in &["notes", "meetings", "attachments", "daily"] {
        tokio::fs::create_dir_all(dir.path().join(sub))
            .await
            .expect("mkdir subdir");
    }
    let db = Arc::new(Db::open(&dir.path().join("index.db")).expect("open db"));
    let storage = Storage::new(dir.path().to_path_buf(), db);
    (dir, storage)
}

#[tokio::test]
async fn terminal_exit_rejects_queued_and_future_writers_after_barrier_drops() {
    let (temp, storage) = fresh_storage().await;
    let barrier = storage.quiesce().await;
    let queued = storage.create_note("must not persist", "# queued");
    tokio::pin!(queued);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), &mut queued)
            .await
            .is_err()
    );
    storage.commit_shutdown(&barrier);
    drop(barrier);
    assert!(queued
        .await
        .unwrap_err()
        .to_string()
        .contains("shutdown committed"));
    assert!(storage.create_note("late writer", "# late").await.is_err());
    assert!(storage.list_notes().await.unwrap().is_empty());
    assert_eq!(
        std::fs::read_dir(temp.path().join("notes"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
async fn exit_barrier_waits_for_mutations_and_blocks_new_file_index_updates() {
    let (_temp, storage) = fresh_storage().await;
    let in_flight = storage.mutation_permit().await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), storage.quiesce())
            .await
            .is_err()
    );
    drop(in_flight);
    let exit = storage.quiesce().await;
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(10),
        storage.create_note("queued", "# queued")
    )
    .await
    .is_err());
    assert!(storage.list_notes().await.unwrap().is_empty());
    drop(exit);
    let note = storage
        .create_note("completed", "# completed")
        .await
        .unwrap();
    let exit = storage.quiesce().await;
    assert_eq!(
        storage.get_note(note.id).await.unwrap().markdown,
        "# completed"
    );
    assert_eq!(
        NoteFile::parse(
            &tokio::fs::read_to_string(storage.vault().join(note.path))
                .await
                .unwrap()
        )
        .unwrap()
        .body,
        "# completed"
    );
    drop(exit);
}

#[tokio::test]
async fn create_note_writes_file_and_indexes() {
    let (tmp, storage) = fresh_storage().await;
    let body = "# My note\n\nhello #tag";
    let note = storage.create_note("My note", body).await.unwrap();

    let abs = tmp.path().join(&note.path);
    assert!(abs.exists(), "note file should exist at {:?}", abs);
    assert!(note.path.starts_with("notes/"));
    assert_eq!(note.tags, vec!["tag"]);

    let fetched = storage.get_note(note.id).await.unwrap();
    assert_eq!(fetched.markdown, body);
    assert_eq!(fetched.note.title, "My note");
}

#[tokio::test]
async fn update_note_rewrites_file_and_retitles_from_first_heading() {
    let (_tmp, storage) = fresh_storage().await;
    let note = storage.create_note("Old", "# Old\n").await.unwrap();

    let updated = storage
        .update_note(note.id, "# Brand New\n\nbody")
        .await
        .unwrap();

    assert_eq!(updated.title, "Brand New");
    let fetched = storage.get_note(note.id).await.unwrap();
    assert_eq!(fetched.markdown, "# Brand New\n\nbody");
}

#[tokio::test]
async fn delete_note_removes_file_and_db_entry() {
    let (tmp, storage) = fresh_storage().await;
    let note = storage.create_note("Bye", "# Bye\n").await.unwrap();
    let abs = tmp.path().join(&note.path);
    assert!(abs.exists());

    storage.delete_note(note.id).await.unwrap();

    assert!(!abs.exists(), "file should be removed");
    assert!(storage.list_notes().await.unwrap().is_empty());
}

#[tokio::test]
async fn create_note_indexes_wikilinks_for_backlinks() {
    let (_tmp, storage) = fresh_storage().await;
    let target = storage
        .create_note("Daily Notes", "# Daily Notes\n")
        .await
        .unwrap();
    let _source = storage
        .create_note("Today", "# Today\n\nSee [[Daily Notes]] for more.")
        .await
        .unwrap();

    let backlinks = storage.backlinks(target.id).await.unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].title, "Today");
}

#[tokio::test]
async fn update_note_removes_stale_wikilinks() {
    let (_tmp, storage) = fresh_storage().await;
    let target = storage
        .create_note("Projects", "# Projects\n")
        .await
        .unwrap();
    let source = storage
        .create_note("Journal", "# Journal\n\n[[Projects]]")
        .await
        .unwrap();
    assert_eq!(storage.backlinks(target.id).await.unwrap().len(), 1);

    // Rewrite the source, dropping the link.
    storage
        .update_note(source.id, "# Journal\n\nNo more mention.")
        .await
        .unwrap();

    assert!(storage.backlinks(target.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn backlinks_match_by_filename_stem_when_title_differs() {
    let (_tmp, storage) = fresh_storage().await;
    // Emulate a note whose file stem differs from its title.
    let target = storage.create_note("Human Title", "body").await.unwrap();
    let stem = path_stem(&target.path).expect("stem");
    let linker = format!("[[{}]]", stem);
    let _ = storage.create_note("Linker", &linker).await.unwrap();

    let backlinks = storage.backlinks(target.id).await.unwrap();
    assert_eq!(backlinks.len(), 1);
}

#[tokio::test]
async fn rebuild_from_vault_indexes_all_markdown_under_notes_and_daily() {
    let (tmp, storage) = fresh_storage().await;
    // Seed the filesystem directly, bypassing the API.
    tokio::fs::write(tmp.path().join("notes/alpha.md"), "# Alpha\n\nbody")
        .await
        .unwrap();
    tokio::fs::write(
        tmp.path().join("notes/beta.md"),
        "# Beta\n\nLinks to [[Alpha]].",
    )
    .await
    .unwrap();
    tokio::fs::write(
        tmp.path().join("daily/2026-04-19.md"),
        "# 2026-04-19\n\n## Notes\n",
    )
    .await
    .unwrap();

    let stats = storage.rebuild_from_vault().await.unwrap();

    assert_eq!(stats.notes_indexed, 3);
    assert_eq!(stats.links_indexed, 1);

    let all = storage.list_notes().await.unwrap();
    assert_eq!(all.len(), 3);
    let titles: std::collections::HashSet<String> = all.iter().map(|n| n.title.clone()).collect();
    assert!(titles.contains("Alpha"));
    assert!(titles.contains("Beta"));
    assert!(titles.contains("2026-04-19"));
}

#[tokio::test]
async fn rebuild_from_vault_replaces_existing_index() {
    let (tmp, storage) = fresh_storage().await;
    // Start with a note created via the API.
    let original = storage.create_note("Old", "# Old\n").await.unwrap();

    // Write a different set of files directly, then rebuild.
    tokio::fs::remove_file(tmp.path().join(&original.path))
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join("notes/fresh.md"), "# Fresh\n")
        .await
        .unwrap();

    let stats = storage.rebuild_from_vault().await.unwrap();
    assert_eq!(stats.notes_indexed, 1);

    let all = storage.list_notes().await.unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].title, "Fresh");
    // The old file was deleted; a distinct legacy path gets its own UUID.
    assert_ne!(all[0].id, original.id);
}

#[tokio::test]
async fn rebuild_from_vault_idempotent_on_repeat() {
    let (tmp, storage) = fresh_storage().await;
    tokio::fs::write(tmp.path().join("notes/one.md"), "# One\n[[Two]]")
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join("notes/two.md"), "# Two\n[[One]]")
        .await
        .unwrap();

    let first = storage.rebuild_from_vault().await.unwrap();
    let second = storage.rebuild_from_vault().await.unwrap();

    assert_eq!(first.notes_indexed, 2);
    assert_eq!(first.links_indexed, 2);
    assert_eq!(first.notes_indexed, second.notes_indexed);
    assert_eq!(first.links_indexed, second.links_indexed);
    assert_eq!(storage.list_notes().await.unwrap().len(), 2);
}

#[tokio::test]
async fn rebuild_from_vault_skips_non_markdown_and_meetings() {
    let (tmp, storage) = fresh_storage().await;
    // .md under notes — indexed.
    tokio::fs::write(tmp.path().join("notes/keep.md"), "# Keep")
        .await
        .unwrap();
    // Non-.md under notes — ignored.
    tokio::fs::write(tmp.path().join("notes/README.txt"), "unrelated")
        .await
        .unwrap();
    // Files under meetings/ — ignored (not part of the notes walk).
    tokio::fs::create_dir_all(tmp.path().join("meetings/abc"))
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join("meetings/abc/transcript.md"), "oops")
        .await
        .unwrap();

    let stats = storage.rebuild_from_vault().await.unwrap();
    assert_eq!(stats.notes_indexed, 1);
}

#[tokio::test]
async fn rebuild_from_vault_tolerates_missing_daily_dir() {
    let (tmp, storage) = fresh_storage().await;
    // Delete daily/ entirely. rebuild_from_vault must treat this
    // as "no daily notes" instead of erroring.
    tokio::fs::remove_dir_all(tmp.path().join("daily"))
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join("notes/x.md"), "# X")
        .await
        .unwrap();

    let stats = storage.rebuild_from_vault().await.unwrap();
    assert_eq!(stats.notes_indexed, 1);
}

#[tokio::test]
async fn rebuild_from_vault_derives_title_from_path_when_heading_missing() {
    let (tmp, storage) = fresh_storage().await;
    tokio::fs::write(
        tmp.path().join("notes/my-titleless-note.md"),
        "no heading here",
    )
    .await
    .unwrap();

    storage.rebuild_from_vault().await.unwrap();
    let all = storage.list_notes().await.unwrap();
    assert_eq!(all[0].title, "my-titleless-note");
}

#[tokio::test]
async fn rebuild_from_vault_skips_invalid_utf8_without_aborting() {
    let (tmp, storage) = fresh_storage().await;
    tokio::fs::write(tmp.path().join("notes/good1.md"), "# One")
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join("notes/good2.md"), "# Two")
        .await
        .unwrap();
    // Invalid UTF-8 — `read_to_string` fails, per-file handler
    // must log+count and keep walking instead of wiping the
    // just-cleared index and returning an error.
    tokio::fs::write(
        tmp.path().join("notes/broken.md"),
        &[0xFFu8, 0xFE, 0xFD, 0x00, 0xC3, 0x28][..],
    )
    .await
    .unwrap();

    let stats = storage.rebuild_from_vault().await.unwrap();
    assert_eq!(stats.notes_indexed, 2);
    assert_eq!(stats.notes_skipped, 1);
}

#[tokio::test]
async fn rebuild_from_vault_preserves_wikilink_backlinks() {
    let (tmp, storage) = fresh_storage().await;
    tokio::fs::write(tmp.path().join("notes/target.md"), "# Target")
        .await
        .unwrap();
    tokio::fs::write(
        tmp.path().join("notes/source.md"),
        "# Source\n\nSee [[Target]].",
    )
    .await
    .unwrap();

    storage.rebuild_from_vault().await.unwrap();
    let all = storage.list_notes().await.unwrap();
    let target = all.iter().find(|n| n.title == "Target").expect("target");
    let backlinks = storage.backlinks(target.id).await.unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].title, "Source");
}

#[tokio::test]
async fn delete_note_preserves_index_when_indexed_file_is_missing() {
    let (tmp, storage) = fresh_storage().await;
    let note = storage.create_note("Ghost", "# Ghost\n").await.unwrap();
    // Remove the file behind the DB's back to simulate an external edit.
    tokio::fs::remove_file(tmp.path().join(&note.path))
        .await
        .unwrap();

    let error = storage.delete_note(note.id).await.unwrap_err();
    assert_eq!(error.to_string(), "note_file_missing_or_moved");
    assert_eq!(storage.list_notes().await.unwrap()[0].id, note.id);
    assert_eq!(storage.search_notes("Ghost").await.unwrap()[0].id, note.id);
}

#[tokio::test]
async fn atomic_write_leaves_no_tmp_behind() {
    let (tmp, storage) = fresh_storage().await;
    let note = storage.create_note("Probe", "# Probe\n").await.unwrap();
    let abs = tmp.path().join(&note.path);
    // No sibling `.coxinha-tmp` file should remain after a
    // successful write — the rename step consumes it.
    let stem = abs.file_name().unwrap().to_string_lossy().into_owned();
    let tmp_file = abs.with_file_name(format!("{}.coxinha-tmp", stem));
    assert!(!tmp_file.exists());
    assert!(abs.exists());
}

#[tokio::test]
async fn daily_note_creates_file_with_template_on_first_call() {
    let (tmp, storage) = fresh_storage().await;
    tokio::fs::create_dir_all(tmp.path().join("daily"))
        .await
        .unwrap();

    let note = storage
        .get_or_create_daily_note(Some("2026-04-18"))
        .await
        .unwrap();

    assert_eq!(note.path, "daily/2026-04-18.md");
    assert_eq!(note.title, "2026-04-18");

    let markdown = tokio::fs::read_to_string(tmp.path().join(&note.path))
        .await
        .unwrap();
    assert!(NoteFile::parse(&markdown)
        .unwrap()
        .body
        .starts_with("# 2026-04-18"));
    assert!(markdown.contains("## Notes"));
}

#[tokio::test]
async fn daily_note_is_idempotent_for_same_date() {
    let (tmp, storage) = fresh_storage().await;
    tokio::fs::create_dir_all(tmp.path().join("daily"))
        .await
        .unwrap();

    let first = storage
        .get_or_create_daily_note(Some("2026-01-01"))
        .await
        .unwrap();
    // User types something; we persist it.
    storage
        .update_note(first.id, "# 2026-01-01\n\nmy thoughts\n")
        .await
        .unwrap();

    // Second call on the same day must return the *same* note
    // without overwriting user edits.
    let second = storage
        .get_or_create_daily_note(Some("2026-01-01"))
        .await
        .unwrap();
    assert_eq!(second.id, first.id);

    let content = tokio::fs::read_to_string(tmp.path().join(&second.path))
        .await
        .unwrap();
    assert!(content.contains("my thoughts"));
}

#[tokio::test]
async fn daily_note_rejects_bad_date() {
    let (_tmp, storage) = fresh_storage().await;
    let err = storage
        .get_or_create_daily_note(Some("04/18/2026"))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("invalid date"));
}

#[tokio::test]
async fn daily_note_defaults_to_today_when_none() {
    let (tmp, storage) = fresh_storage().await;
    tokio::fs::create_dir_all(tmp.path().join("daily"))
        .await
        .unwrap();

    let note = storage.get_or_create_daily_note(None).await.unwrap();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    assert_eq!(note.title, today);
    assert_eq!(note.path, format!("daily/{}.md", today));
}
