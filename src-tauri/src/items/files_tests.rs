use super::files::*;
use super::folder::{ItemKind, ItemRef};
use std::fs;
use std::path::Path;

fn activity() -> ItemRef {
    ItemRef {
        kind: ItemKind::Activity,
        id: "n-1".into(),
        title: "Deck".into(),
        date: None,
    }
}

fn source(dir: &Path, name: &str, body: &str) -> String {
    let path = dir.join(name);
    fs::write(&path, body).unwrap();
    path.to_string_lossy().into_owned()
}

#[test]
fn listing_an_item_without_files_creates_nothing() {
    let vault = tempfile::tempdir().unwrap();
    let files = list(vault.path(), &activity()).unwrap();
    assert_eq!(files.folder, None);
    assert!(files.files.is_empty() && files.references.is_empty());
    assert!(!vault.path().join("activities").exists());
}

#[test]
fn including_copies_and_numbers_taken_names() {
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let deck = source(outside.path(), "deck.html", "<h1>v1</h1>");
    include(vault.path(), &activity(), std::slice::from_ref(&deck)).unwrap();
    let files = include(vault.path(), &activity(), std::slice::from_ref(&deck)).unwrap();
    let mut names: Vec<_> = files.files.iter().map(|f| f.name.as_str()).collect();
    names.sort();
    assert_eq!(names, ["deck (2).html", "deck.html"]);
    assert!(files
        .files
        .iter()
        .all(|f| f.kind == "html" && f.bytes == 11.0));
    assert!(Path::new(&deck).exists(), "the source stays where it was");
    assert!(include(vault.path(), &activity(), &["relative.html".into()]).is_err());
}

#[test]
fn references_keep_paths_and_urls_once_and_flag_missing_paths() {
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let deck = source(outside.path(), "live.html", "x");
    reference(vault.path(), &activity(), &deck, Some("Deck".into())).unwrap();
    reference(vault.path(), &activity(), &deck, None).unwrap();
    reference(vault.path(), &activity(), "https://example.com/deck", None).unwrap();
    let gone = outside.path().join("gone.html");
    let files = reference(vault.path(), &activity(), &gone.to_string_lossy(), None).unwrap();
    assert_eq!(files.references.len(), 3);
    assert_eq!(files.references[0].label.as_deref(), Some("Deck"));
    assert!(files.references[1].is_url && !files.references[1].missing);
    assert!(files.references[2].missing);
    assert!(reference(vault.path(), &activity(), "notes/x.md", None).is_err());
    assert!(reference(vault.path(), &activity(), "ftp://host/x", None).is_err());

    let files = remove_reference(vault.path(), &activity(), &deck).unwrap();
    assert_eq!(files.references.len(), 2);
}

#[test]
fn removing_a_file_moves_it_to_the_trash() {
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let deck = source(outside.path(), "deck.html", "x");
    include(vault.path(), &activity(), &[deck]).unwrap();
    let files = remove_file(vault.path(), &activity(), "deck.html").unwrap();
    assert!(files.files.is_empty());
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    assert!(vault
        .path()
        .join(".coxinha/trash")
        .join(day)
        .join("deck.html")
        .is_file());
    assert!(remove_file(vault.path(), &activity(), "../escape.html").is_err());
}

#[test]
fn open_accepts_only_folder_files_and_recorded_references() {
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let deck = source(outside.path(), "deck.html", "x");
    include(vault.path(), &activity(), std::slice::from_ref(&deck)).unwrap();
    reference(vault.path(), &activity(), "https://example.com/d", None).unwrap();

    let file = OpenTarget::File {
        name: "deck.html".into(),
    };
    assert!(matches!(
        resolve(vault.path(), &activity(), &file).unwrap(),
        Resolved::Path(p) if p.ends_with("activities/Deck/deck.html")
    ));
    let url = OpenTarget::Reference {
        target: "https://example.com/d".into(),
    };
    assert_eq!(
        resolve(vault.path(), &activity(), &url).unwrap(),
        Resolved::Url("https://example.com/d".into())
    );
    for bad in [
        OpenTarget::File {
            name: "../deck.html".into(),
        },
        OpenTarget::File { name: deck.clone() },
        OpenTarget::File {
            name: ".coxinha-item.json".into(),
        },
        OpenTarget::Reference { target: deck },
        OpenTarget::Reference {
            target: "https://evil.example".into(),
        },
    ] {
        assert!(resolve(vault.path(), &activity(), &bad).is_err(), "{bad:?}");
    }
}

#[test]
fn programs_are_never_opened() {
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let setup = source(outside.path(), "Setup.EXE", "x");
    let script = source(outside.path(), "run.sh", "x");
    include(vault.path(), &activity(), &[setup, script.clone()]).unwrap();
    reference(vault.path(), &activity(), &script, None).unwrap();
    for target in [
        OpenTarget::File {
            name: "Setup.EXE".into(),
        },
        OpenTarget::File {
            name: "run.sh".into(),
        },
        OpenTarget::Reference { target: script },
    ] {
        assert!(
            resolve(vault.path(), &activity(), &target).is_err(),
            "{target:?}"
        );
    }
}

#[cfg(unix)]
#[test]
fn executable_files_are_never_opened() {
    use std::os::unix::fs::PermissionsExt;
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let tool = source(outside.path(), "tool", "x");
    fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).unwrap();
    include(vault.path(), &activity(), &[tool]).unwrap();
    let target = OpenTarget::File {
        name: "tool".into(),
    };
    assert!(resolve(vault.path(), &activity(), &target).is_err());
}

#[cfg(unix)]
#[test]
fn symlinks_cannot_escape_the_item_folder() {
    let vault = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let deck = source(outside.path(), "deck.html", "x");
    let secret = source(outside.path(), "secret.txt", "s");
    let files = include(vault.path(), &activity(), &[deck]).unwrap();
    let dir = Path::new(files.folder.as_deref().unwrap());
    std::os::unix::fs::symlink(&secret, dir.join("link.txt")).unwrap();
    let target = OpenTarget::File {
        name: "link.txt".into(),
    };
    assert!(resolve(vault.path(), &activity(), &target).is_err());
}

#[test]
fn urls_need_a_scheme_host_and_no_spaces() {
    assert!(is_url("https://example.com"));
    assert!(is_url("HTTP://example.com/a"));
    assert!(!is_url("https://"));
    assert!(!is_url("https://a b"));
    assert!(!is_url("file:///etc/passwd"));
}
