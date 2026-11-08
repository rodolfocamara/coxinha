use super::links::*;

#[test]
fn a_link_is_stored_once_and_read_from_both_ends() {
    let vault = tempfile::tempdir().unwrap();
    assert!(list(vault.path(), None, None).unwrap().is_empty());
    add(vault.path(), "s-1", "n-1").unwrap();
    add(vault.path(), "s-1", "n-1").unwrap();
    add(vault.path(), "s-1", "n-2").unwrap();
    add(vault.path(), "s-2", "n-1").unwrap();

    let of_session = list(vault.path(), Some("s-1"), None).unwrap();
    assert_eq!(
        of_session
            .iter()
            .map(|l| l.note.as_str())
            .collect::<Vec<_>>(),
        ["n-1", "n-2"]
    );
    let of_note = list(vault.path(), None, Some("n-1")).unwrap();
    assert_eq!(
        of_note
            .iter()
            .map(|l| l.session.as_str())
            .collect::<Vec<_>>(),
        ["s-1", "s-2"]
    );

    remove(vault.path(), "s-1", "n-1").unwrap();
    remove(vault.path(), "s-1", "n-1").unwrap();
    assert_eq!(list(vault.path(), None, Some("n-1")).unwrap().len(), 1);
}

#[test]
fn the_links_file_is_versioned_json_without_temporary_leftovers() {
    let vault = tempfile::tempdir().unwrap();
    add(vault.path(), "s-1", "n-1").unwrap();
    let raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(vault.path().join(".coxinha/links.json")).unwrap())
            .unwrap();
    assert_eq!(raw["version"], 1);
    assert_eq!(raw["links"][0]["session"], "s-1");
    assert!(raw["links"][0]["createdAt"].is_string());
    let mut entries: Vec<_> = std::fs::read_dir(vault.path().join(".coxinha"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    entries.sort();
    // The lock file stays; the app and `Coxinha cli` share it.
    assert_eq!(entries, ["links.json", "links.lock"]);
}

#[test]
fn ids_are_validated_and_a_corrupt_file_is_not_overwritten() {
    let vault = tempfile::tempdir().unwrap();
    assert!(add(vault.path(), "../s", "n-1").is_err());
    std::fs::create_dir_all(vault.path().join(".coxinha")).unwrap();
    std::fs::write(vault.path().join(".coxinha/links.json"), "{oops").unwrap();
    assert!(add(vault.path(), "s-1", "n-1").is_err());
    assert_eq!(
        std::fs::read_to_string(vault.path().join(".coxinha/links.json")).unwrap(),
        "{oops"
    );
}
