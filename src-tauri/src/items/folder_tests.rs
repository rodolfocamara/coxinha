use super::folder::*;
use std::fs;

fn meeting(title: &str) -> ItemRef {
    ItemRef {
        kind: ItemKind::Meeting,
        id: "s-1".into(),
        title: title.into(),
        date: Some("2026-11-03".into()),
    }
}

#[test]
fn safe_names_drop_separators_reserved_words_and_dots() {
    assert_eq!(safe_name("  a/b\\c:d*e?  ", "id"), "a b c d e");
    assert_eq!(safe_name("..hidden..", "id"), "hidden");
    assert_eq!(safe_name("CON", "id"), "CON_");
    assert_eq!(safe_name("com1.txt", "id"), "com1.txt_");
    assert_eq!(safe_name("COM10", "id"), "COM10");
    assert_eq!(safe_name("\u{7}\t", "id"), "id");
    assert_eq!(safe_name(&"x".repeat(200), "id").chars().count(), 80);
}

#[test]
fn meetings_are_named_by_date_and_title_activities_by_title() {
    assert_eq!(
        desired_name(&meeting("Project Atlas")),
        "2026-11-03 Project Atlas"
    );
    let mut bad_date = meeting("Atlas");
    bad_date.date = Some("03/11/2026".into());
    assert_eq!(desired_name(&bad_date), "Atlas");
    let activity = ItemRef {
        kind: ItemKind::Activity,
        id: "n-1".into(),
        title: "".into(),
        date: Some("2026-11-03".into()),
    };
    assert_eq!(desired_name(&activity), "n-1");
}

#[test]
fn looking_never_creates_and_ids_must_be_plain() {
    let vault = tempfile::tempdir().unwrap();
    assert_eq!(find(vault.path(), &meeting("Atlas")).unwrap(), None);
    assert!(!vault.path().join("meetings").exists());
    let mut bad = meeting("Atlas");
    bad.id = "../x".into();
    assert!(find(vault.path(), &bad).is_err());
}

#[test]
fn folders_are_found_by_id_and_follow_the_title_when_free() {
    let vault = tempfile::tempdir().unwrap();
    let first = ensure(vault.path(), &meeting("Atlas")).unwrap();
    assert!(first.ends_with("meetings/2026-11-03 Atlas"));
    assert_eq!(read_marker(&first).unwrap().id, "s-1");

    // Readers locate without renaming.
    let located = locate(vault.path(), &meeting("Project Atlas"))
        .unwrap()
        .unwrap();
    assert_eq!(located, first);
    assert!(first.exists());

    let renamed = find(vault.path(), &meeting("Project Atlas"))
        .unwrap()
        .unwrap();
    assert!(renamed.ends_with("meetings/2026-11-03 Project Atlas"));
    assert!(!first.exists());

    // A name taken by another folder keeps the current one.
    fs::create_dir(vault.path().join("meetings/2026-11-03 Taken")).unwrap();
    let kept = find(vault.path(), &meeting("Taken")).unwrap().unwrap();
    assert_eq!(kept, renamed);
}

#[test]
fn a_new_folder_never_reuses_a_taken_name() {
    let vault = tempfile::tempdir().unwrap();
    fs::create_dir_all(vault.path().join("meetings/2026-11-03 Atlas")).unwrap();
    let dir = ensure(vault.path(), &meeting("Atlas")).unwrap();
    assert!(dir.ends_with("meetings/2026-11-03 Atlas (2)"));
    let other = ItemRef {
        kind: ItemKind::Activity,
        ..meeting("Atlas")
    };
    // Same id, other kind: its own folder under activities/.
    assert!(ensure(vault.path(), &other)
        .unwrap()
        .ends_with("activities/Atlas"));
}

#[test]
fn free_paths_number_before_the_extension() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("deck.html"), "a").unwrap();
    fs::write(dir.path().join("deck (2).html"), "b").unwrap();
    let next = free_path(dir.path(), "deck.html", |p| p.exists());
    assert!(next.ends_with("deck (3).html"));
    assert!(free_path(dir.path(), "README", |p| p.exists()).ends_with("README"));
}
