use super::*;

fn legacy() -> Vec<u8> {
    br#"{"version":1,"revision":7,"items":[{"id":"card","kind":"card","x":1,"y":2,"width":230,"height":100,"color":"blue","label":"","noteId":"00000000-0000-4000-8000-000000000001","notePath":"notes/activity.md"}],"edges":[]}"#.to_vec()
}
#[test]
fn legacy_progress_defaults_without_writing_then_first_save_preserves_exact_backup() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join(".coxinha");
    fs::create_dir(&dir).unwrap();
    let path = dir.join("board.json");
    fs::write(&path, legacy()).unwrap();
    let mut board = read(&path).unwrap();
    assert_eq!(board.items[0].progress, 0);
    assert_eq!(fs::read(&path).unwrap(), legacy());
    assert!(!dir.join("board-before-v3.json").exists());
    board.items[0].progress = 75;
    let saved = save(root.path(), board).unwrap();
    assert_eq!((saved.version, saved.revision), (3, 8));
    assert_eq!(read(&path).unwrap().items[0].progress, 75);
    assert_eq!(
        fs::read(dir.join("board-before-v3.json")).unwrap(),
        legacy()
    );
    save(root.path(), saved).unwrap();
    assert_eq!(
        fs::read(dir.join("board-before-v3.json")).unwrap(),
        legacy()
    );
}
#[test]
fn invalid_progress_and_stale_revision_never_change_canonical_or_backup() {
    let root = tempfile::tempdir().unwrap();
    let initial = save(root.path(), Board::default()).unwrap();
    let path = root.path().join(".coxinha/board.json");
    let bytes = fs::read(&path).unwrap();
    let mut invalid: Board = serde_json::from_slice(&legacy()).unwrap();
    invalid.revision = initial.revision;
    invalid.items[0].progress = 101;
    assert!(save(root.path(), invalid.clone()).is_err());
    invalid.items[0].progress = 50;
    invalid.revision = 0;
    assert!(save(root.path(), invalid).is_err());
    assert_eq!(fs::read(path).unwrap(), bytes);
    assert!(!root.path().join(".coxinha/board-before-v3.json").exists());
}
#[test]
fn progress_and_layer_order_round_trip_with_note_references_untouched() {
    let root = tempfile::tempdir().unwrap();
    let mut board: Board = serde_json::from_slice(&legacy()).unwrap();
    board.revision = 0;
    board.items[0].progress = 100;
    let mut other = board.items[0].clone();
    other.id = "other".into();
    other.progress = 25;
    board.items.insert(0, other);
    let saved = save(root.path(), board).unwrap();
    let loaded = read(&root.path().join(".coxinha/board.json")).unwrap();
    assert_eq!(loaded.items[0].id, "other");
    assert_eq!(loaded.items[1].progress, 100);
    assert_eq!(loaded.items[0].note_id, saved.items[0].note_id);
}
