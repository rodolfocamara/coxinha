//! Canonical board sidecar. Include `.coxinha/board.json` in vault backups.
use crate::storage::Storage;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    sync::Arc,
};

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub color: String,
    pub label: String,
    #[serde(default)]
    pub progress: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub note_id: Option<String>,
    pub note_path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct Board {
    pub version: u32,
    pub revision: u32,
    pub items: Vec<Item>,
    pub edges: Vec<Edge>,
}
impl Default for Board {
    fn default() -> Self {
        Self {
            version: 3,
            revision: 0,
            items: vec![],
            edges: vec![],
        }
    }
}
fn validate(board: &Board) -> Result<(), String> {
    if ![1, 2, 3].contains(&board.version) || board.items.len() > 10000 || board.edges.len() > 30000
    {
        return Err("unsupported board version or size".into());
    }
    let mut ids = HashSet::new();
    let mut cards = HashSet::new();
    for item in &board.items {
        if item.id.is_empty()
            || item.id.len() > 100
            || !ids.insert(&item.id)
            || ![item.x, item.y, item.width, item.height]
                .iter()
                .all(|n| n.is_finite() && n.abs() <= 1_000_000.)
            || item.progress > 100
            || item.width < 100.
            || item.height < 60.
            || item.label.chars().count() > 1000
            || !["neutral", "orange", "green", "blue", "purple"].contains(&item.color.as_str())
        {
            return Err("invalid board item".into());
        }
        match item.kind.as_str() {
            "card" | "text" => {
                if item.kind == "text" && board.version < 3 {
                    return Err("text requires board v3".into());
                }
                let id = item.note_id.as_deref().ok_or("missing note reference")?;
                uuid::Uuid::parse_str(id).map_err(|_| "invalid note UUID")?;
                let path = item.note_path.as_deref().ok_or("missing note path")?;
                if !path.ends_with(".md")
                    || Path::new(path).is_absolute()
                    || Path::new(path)
                        .components()
                        .any(|c| !matches!(c, std::path::Component::Normal(_)))
                {
                    return Err("invalid note path".into());
                }
                if item.kind == "card" {
                    cards.insert(&item.id);
                }
            }
            "area" if item.note_id.is_none() && item.note_path.is_none() => {}
            _ => return Err("invalid item kind".into()),
        }
    }
    for item in &board.items {
        if let Some(parent) = &item.parent_id {
            if board.version < 3
                || item.kind == "area"
                || parent == &item.id
                || !board
                    .items
                    .iter()
                    .any(|area| &area.id == parent && area.kind == "area")
            {
                return Err("invalid area parent".into());
            }
        }
    }
    let mut edges = HashSet::new();
    let mut pairs = HashSet::new();
    for edge in &board.edges {
        if edge.id.is_empty()
            || !edges.insert(&edge.id)
            || edge.source == edge.target
            || !cards.contains(&edge.source)
            || !cards.contains(&edge.target)
            || !pairs.insert((&edge.source, &edge.target))
        {
            return Err("invalid dependency".into());
        }
    }
    Ok(())
}
fn read(path: &Path) -> Result<Board, String> {
    if fs::metadata(path)
        .map(|m| m.len() > 8_000_000)
        .unwrap_or(false)
    {
        return Err("board too large".into());
    }
    match fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > 8_000_000 {
                return Err("board too large".into());
            }
            let board = serde_json::from_slice(&bytes).map_err(|_| "invalid board JSON")?;
            validate(&board)?;
            Ok(board)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Board::default()),
        Err(_) => Err("cannot read board".into()),
    }
}
fn save(root: &Path, mut board: Board) -> Result<Board, String> {
    validate(&board)?;
    let dir = root.join(".coxinha");
    fs::create_dir_all(&dir).map_err(|_| "cannot create board directory")?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("board.lock"))
        .map_err(|_| "cannot open board lock")?;
    lock.lock().map_err(|_| "cannot lock board")?;
    let path = dir.join("board.json");
    let current = read(&path)?;
    if board.revision != current.revision {
        return Err("board revision conflict: reload required".into());
    }
    // Preserve exact old bytes before the first explicit schema upgrade.
    if current.version < 3 && path.exists() {
        let backup = dir.join("board-before-v3.json");
        let original = fs::read(&path).map_err(|_| "cannot read legacy board backup")?;
        if !backup.exists() {
            let mut copy =
                tempfile::NamedTempFile::new_in(&dir).map_err(|_| "cannot create board backup")?;
            copy.write_all(&original)
                .and_then(|_| copy.as_file().sync_all())
                .map_err(|_| "cannot sync board backup")?;
            copy.persist_noclobber(&backup)
                .map_err(|_| "cannot preserve legacy board")?;
        }
    }
    board.version = 3;
    board.revision = board.revision.checked_add(1).ok_or("revision exhausted")?;
    let bytes = serde_json::to_vec_pretty(&board).map_err(|_| "cannot encode board")?;
    let mut tmp =
        tempfile::NamedTempFile::new_in(&dir).map_err(|_| "cannot create board temporary file")?;
    tmp.write_all(&bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "cannot sync board")?;
    tmp.persist(&path)
        .map_err(|_| "cannot atomically replace board")?;
    #[cfg(unix)]
    File::open(&dir)
        .and_then(|d| d.sync_all())
        .map_err(|_| "cannot sync board directory")?;
    Ok(board)
}
#[tauri::command]
#[specta::specta]
pub async fn board_load(storage: tauri::State<'_, Arc<Storage>>) -> Result<Board, String> {
    let mut board = read(&storage.vault().join(".coxinha/board.json"))?;
    let notes = storage
        .list_notes()
        .await
        .map_err(|_| "cannot resolve board notes")?;
    for item in &mut board.items {
        if item.kind == "card" || item.kind == "text" {
            if let Some(note) = notes
                .iter()
                .find(|n| Some(n.path.as_str()) == item.note_path.as_deref())
            {
                item.note_id = Some(note.id.to_string());
            }
        }
    }
    Ok(board)
}
#[tauri::command]
#[specta::specta]
pub async fn board_save(
    storage: tauri::State<'_, Arc<Storage>>,
    board: Board,
) -> Result<Board, String> {
    let _operation = storage
        .mutation_permit()
        .await
        .map_err(|_| "desktop shutdown committed".to_string())?;
    // Existing unresolved cards remain recoverable; newly invented references are rejected.
    let old = read(&storage.vault().join(".coxinha/board.json"))?;
    let notes = storage
        .list_notes()
        .await
        .map_err(|_| "cannot validate board notes")?;
    for item in board
        .items
        .iter()
        .filter(|i| i.kind == "card" || i.kind == "text")
    {
        if !notes.iter().any(|n| {
            Some(n.id.to_string()) == item.note_id && Some(&n.path) == item.note_path.as_ref()
        }) && !old
            .items
            .iter()
            .any(|o| o.id == item.id && o.note_path == item.note_path && o.note_id == item.note_id)
        {
            return Err("unknown note reference".into());
        }
    }
    save(storage.vault(), board)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_and_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let b = save(dir.path(), Board::default()).unwrap();
        assert_eq!(
            read(&dir.path().join(".coxinha/board.json"))
                .unwrap()
                .revision,
            1
        );
        assert!(save(dir.path(), Board::default())
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(save(dir.path(), b).unwrap().revision, 2);
    }
    #[test]
    fn malformed_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".coxinha")).unwrap();
        let p = dir.path().join(".coxinha/board.json");
        fs::write(&p, b"bad").unwrap();
        assert!(save(dir.path(), Board::default()).is_err());
        assert_eq!(fs::read(p).unwrap(), b"bad");
    }
    #[test]
    fn invalid_references_and_edges() {
        let mut b = Board::default();
        b.edges.push(Edge {
            id: "e".into(),
            source: "absent".into(),
            target: "absent2".into(),
        });
        assert!(validate(&b).is_err());
        b.edges.clear();
        b.version = 4;
        assert!(validate(&b).is_err());
        b.version = 1;
        b.items.push(Item {
            id: "a".into(),
            kind: "card".into(),
            x: 0.,
            y: 0.,
            width: 200.,
            height: 100.,
            color: "blue".into(),
            label: "".into(),
            progress: 0,
            parent_id: None,
            note_id: Some("bad".into()),
            note_path: Some("../notes.md".into()),
        });
        assert!(validate(&b).is_err());
    }
}

/// Export only inside the current vault; no arbitrary filesystem capability is granted.
#[tauri::command]
#[specta::specta]
pub async fn board_export_recovery(
    storage: tauri::State<'_, Arc<Storage>>,
    board: Board,
) -> Result<String, String> {
    let _operation = storage
        .mutation_permit()
        .await
        .map_err(|_| "desktop shutdown committed".to_string())?;
    export_recovery(storage.vault(), &board)
}
fn export_recovery(root: &Path, board: &Board) -> Result<String, String> {
    let directory = root.join(".coxinha/recovery");
    fs::create_dir_all(&directory).map_err(|_| "cannot create recovery directory")?;
    let path = directory.join(format!("board-{}.json", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(board).map_err(|_| "cannot encode recovery")?;
    if bytes.len() > 8_000_000 {
        return Err("recovery too large".into());
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(&directory).map_err(|_| "cannot create recovery file")?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "cannot sync recovery")?;
    temporary
        .persist_noclobber(&path)
        .map_err(|_| "cannot persist recovery")?;
    #[cfg(unix)]
    File::open(&directory)
        .and_then(|d| d.sync_all())
        .map_err(|_| "cannot sync recovery directory")?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn recovery_is_unique_and_inside_vault_without_replacing_canonical_board() {
        let root = tempfile::tempdir().unwrap();
        let board = save(root.path(), Board::default()).unwrap();
        let before = fs::read(root.path().join(".coxinha/board.json")).unwrap();
        let first = export_recovery(root.path(), &board).unwrap();
        let second = export_recovery(root.path(), &board).unwrap();
        assert_ne!(first, second);
        assert!(Path::new(&first).starts_with(root.path().join(".coxinha/recovery")));
        assert_eq!(read(Path::new(&first)).unwrap().revision, board.revision);
        assert_eq!(
            fs::read(root.path().join(".coxinha/board.json")).unwrap(),
            before
        );
    }
}

#[cfg(test)]
#[path = "board_progress_tests.rs"]
mod progress_tests;

#[cfg(test)]
#[path = "board_hierarchy_tests.rs"]
mod hierarchy_tests;
