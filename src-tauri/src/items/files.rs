//! Files and references of an item (spec 0105 P2–P3).
use super::folder::{self, ItemRef, Reference, MARKER};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemFile {
    pub name: String,
    /// Lowercase extension without the dot, empty when none.
    pub kind: String,
    pub bytes: f64,
    /// RFC 3339; empty when the filesystem has no modification time.
    pub modified: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemReference {
    pub target: String,
    pub label: Option<String>,
    pub added_at: String,
    pub is_url: bool,
    pub missing: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemFiles {
    pub folder: Option<String>,
    pub files: Vec<ItemFile>,
    pub references: Vec<ItemReference>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OpenTarget {
    File { name: String },
    Reference { target: String },
}

/// What the opener receives once the target is validated.
#[derive(Debug, PartialEq)]
pub enum Resolved {
    Path(PathBuf),
    Url(String),
}

pub fn is_url(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && target.len() > 8
        && !target.chars().any(char::is_whitespace)
}

pub fn list(vault: &Path, item: &ItemRef) -> Result<ItemFiles, String> {
    let Some(dir) = folder::find(vault, item)? else {
        return Ok(ItemFiles {
            folder: None,
            files: Vec::new(),
            references: Vec::new(),
        });
    };
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir)
        .map_err(|_| "cannot read item folder")?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        if name == MARKER || !meta.is_file() {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
            .unwrap_or_default();
        let kind = Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        files.push(ItemFile {
            name,
            kind,
            bytes: meta.len() as f64,
            modified,
        });
    }
    files.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
    let references = folder::read_marker(&dir)
        .map(|m| m.references)
        .unwrap_or_default()
        .into_iter()
        .map(|r| {
            let url = is_url(&r.target);
            ItemReference {
                missing: !url && !Path::new(&r.target).exists(),
                is_url: url,
                target: r.target,
                label: r.label,
                added_at: r.added_at,
            }
        })
        .collect();
    Ok(ItemFiles {
        folder: Some(dir.to_string_lossy().into_owned()),
        files,
        references,
    })
}

/// Copies the files in, numbering names already taken.
pub fn include(vault: &Path, item: &ItemRef, sources: &[String]) -> Result<ItemFiles, String> {
    for source in sources {
        let path = Path::new(source);
        if !path.is_absolute() || !path.is_file() {
            return Err(format!("not a file: {source}"));
        }
    }
    let dir = folder::ensure(vault, item)?;
    for source in sources {
        let path = Path::new(source);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or("file without a name")?;
        let name = if name == MARKER {
            "coxinha-item.json".into()
        } else {
            name
        };
        let target = folder::free_path(&dir, &name, |p| p.exists());
        fs::copy(path, &target).map_err(|_| format!("cannot copy {name}"))?;
    }
    list(vault, item)
}

/// Records a path or URL without copying; the same target is kept once.
pub fn reference(
    vault: &Path,
    item: &ItemRef,
    target: &str,
    label: Option<String>,
) -> Result<ItemFiles, String> {
    let target = target.trim();
    if !is_url(target) && !Path::new(target).is_absolute() {
        return Err("a reference is an absolute path or an http(s) URL".into());
    }
    let dir = folder::ensure(vault, item)?;
    let mut marker = folder::read_marker(&dir).ok_or("cannot read item marker")?;
    if !marker.references.iter().any(|r| r.target == target) {
        marker.references.push(Reference {
            target: target.to_string(),
            label: label.filter(|l| !l.trim().is_empty()),
            added_at: chrono::Utc::now().to_rfc3339(),
        });
        folder::write_marker(&dir, &marker)?;
    }
    list(vault, item)
}

pub fn remove_reference(vault: &Path, item: &ItemRef, target: &str) -> Result<ItemFiles, String> {
    if let Some(dir) = folder::find(vault, item)? {
        let mut marker = folder::read_marker(&dir).ok_or("cannot read item marker")?;
        marker.references.retain(|r| r.target != target);
        folder::write_marker(&dir, &marker)?;
    }
    list(vault, item)
}

/// Moves an included file to `.coxinha/trash/<date>/`, never deletes it.
pub fn remove_file(vault: &Path, item: &ItemRef, name: &str) -> Result<ItemFiles, String> {
    let dir = folder::find(vault, item)?.ok_or("item has no files")?;
    let source = inside(&dir, name)?;
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let trash = vault.join(".coxinha/trash").join(day);
    fs::create_dir_all(&trash).map_err(|_| "cannot create trash folder")?;
    let target = folder::free_path(&trash, name, |p| p.exists());
    fs::rename(&source, &target).map_err(|_| "cannot move the file to the trash")?;
    list(vault, item)
}

/// Only a file inside the folder, a recorded reference, or an http(s) URL.
pub fn resolve(vault: &Path, item: &ItemRef, target: &OpenTarget) -> Result<Resolved, String> {
    let dir = folder::find(vault, item)?.ok_or("item has no files")?;
    match target {
        OpenTarget::File { name } => inside(&dir, name).map(Resolved::Path),
        OpenTarget::Reference { target } => {
            let marker = folder::read_marker(&dir).ok_or("cannot read item marker")?;
            if !marker.references.iter().any(|r| &r.target == target) {
                return Err("unknown reference".into());
            }
            Ok(if is_url(target) {
                Resolved::Url(target.clone())
            } else {
                Resolved::Path(PathBuf::from(target))
            })
        }
    }
}

/// A single plain file name inside `dir`, also after resolving symlinks.
fn inside(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let mut parts = Path::new(name).components();
    let plain = matches!(parts.next(), Some(Component::Normal(_))) && parts.next().is_none();
    if !plain || name == MARKER {
        return Err("invalid file name".into());
    }
    let path = dir.join(name);
    let real = path.canonicalize().map_err(|_| "file not found")?;
    let root = dir
        .canonicalize()
        .map_err(|_| "cannot resolve item folder")?;
    if !real.starts_with(&root) || !real.is_file() {
        return Err("file is outside the item folder".into());
    }
    Ok(path)
}
