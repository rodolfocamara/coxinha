use super::*;
fn fixture() -> Board {
    serde_json::from_str(r##"{"version":3,"revision":0,"items":[{"id":"area","kind":"area","x":0,"y":0,"width":600,"height":400,"color":"blue","label":"Project","noteId":null,"notePath":null},{"id":"card","kind":"card","parentId":"area","x":20,"y":60,"width":320,"height":180,"color":"neutral","label":"","progress":50,"noteId":"00000000-0000-4000-8000-000000000001","notePath":"notes/a.md"}],"edges":[]}"##).unwrap()
}
#[test]
fn hierarchy_and_text_round_trip_without_rewriting_notes() {
    let root = tempfile::tempdir().unwrap();
    let mut b = fixture();
    let mut text = b.items[1].clone();
    text.id = "text".into();
    text.kind = "text".into();
    b.items.push(text);
    let saved = save(root.path(), b).unwrap();
    assert_eq!(saved.version, 3);
    let loaded = read(&root.path().join(".coxinha/board.json")).unwrap();
    assert_eq!(loaded.items[2].parent_id.as_deref(), Some("area"));
    assert!(!root.path().join("notes").exists());
}
#[test]
fn invalid_parent_never_overwrites_and_legacy_reads_do_not_write() {
    let root = tempfile::tempdir().unwrap();
    let b = save(root.path(), fixture()).unwrap();
    let path = root.path().join(".coxinha/board.json");
    let bytes = fs::read(&path).unwrap();
    for parent in ["missing", "card"] {
        let mut bad = b.clone();
        bad.items[1].parent_id = Some(parent.into());
        assert!(save(root.path(), bad).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    let mut nested = b.clone();
    nested.items[0].parent_id = Some("card".into());
    assert!(save(root.path(), nested).is_err());
    let mut legacy = fixture();
    legacy.version = 2;
    legacy.items[1].parent_id = None;
    let old = serde_json::to_vec(&legacy).unwrap();
    fs::write(&path, &old).unwrap();
    let read_only = read(&path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), old);
    let upgraded = save(root.path(), read_only).unwrap();
    assert_eq!(upgraded.version, 3);
    assert_eq!(
        fs::read(root.path().join(".coxinha/board-before-v3.json")).unwrap(),
        old
    );
}
