//! Item folders (spec 0105 P1): a readable folder per meeting or activity,
//! found by the id in its marker so renames never lose it.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MARKER: &str = ".coxinha-item.json";
const MAX_NAME: usize = 80;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Meeting,
    Activity,
}

impl ItemKind {
    fn dir(self) -> &'static str {
        match self {
            ItemKind::Meeting => "meetings",
            ItemKind::Activity => "activities",
        }
    }
}

/// What the frontend knows about the item; the backend derives the name.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef {
    pub kind: ItemKind,
    pub id: String,
    pub title: String,
    /// `YYYY-MM-DD`, meetings only.
    pub date: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub target: String,
    pub label: Option<String>,
    pub added_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub version: u32,
    pub kind: ItemKind,
    pub id: String,
    #[serde(default)]
    pub references: Vec<Reference>,
}

pub fn valid_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then_some(()).ok_or_else(|| "invalid item id".into())
}

/// A folder name that is safe on Windows, macOS and Linux.
pub fn safe_name(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut name = collapsed
        .trim_start_matches(['.', ' '])
        .trim_end_matches(['.', ' '])
        .to_string();
    if name.chars().count() > MAX_NAME {
        name = name.chars().take(MAX_NAME).collect();
        name = name.trim_end_matches(['.', ' ']).to_string();
    }
    if name.is_empty() {
        return fallback.to_string();
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        name.push('_');
    }
    name
}

pub fn desired_name(item: &ItemRef) -> String {
    let title = item.title.trim();
    let base = match (item.kind, item.date.as_deref()) {
        (ItemKind::Meeting, Some(date)) if valid_date(date) => format!("{date} {title}"),
        _ => title.to_string(),
    };
    safe_name(&base, &item.id)
}

fn valid_date(date: &str) -> bool {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok()
}

pub fn read_marker(dir: &Path) -> Option<Marker> {
    let bytes = fs::read(dir.join(MARKER)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_marker(dir: &Path, marker: &Marker) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(marker).map_err(|_| "cannot encode item marker")?;
    let mut tmp =
        tempfile::NamedTempFile::new_in(dir).map_err(|_| "cannot create item marker file")?;
    tmp.write_all(&bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "cannot sync item marker")?;
    tmp.persist(dir.join(MARKER))
        .map_err(|_| "cannot replace item marker")?;
    Ok(())
}

/// The item's folder, renamed to follow its title when that name is free.
pub fn find(vault: &Path, item: &ItemRef) -> Result<Option<PathBuf>, String> {
    let Some(dir) = locate(vault, item)? else {
        return Ok(None);
    };
    let wanted = vault.join(item.kind.dir()).join(desired_name(item));
    if wanted != dir && !wanted.exists() && fs::rename(&dir, &wanted).is_ok() {
        return Ok(Some(wanted));
    }
    Ok(Some(dir))
}

/// The item's folder by its marker id, without renaming anything.
pub fn locate(vault: &Path, item: &ItemRef) -> Result<Option<PathBuf>, String> {
    valid_id(&item.id)?;
    let base = vault.join(item.kind.dir());
    let Ok(entries) = fs::read_dir(&base) else {
        return Ok(None);
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Some(marker) = read_marker(&dir) else {
            continue;
        };
        if marker.id != item.id || marker.kind != item.kind {
            continue;
        }
        return Ok(Some(dir));
    }
    Ok(None)
}

/// The item's folder, created with its marker on first write.
pub fn ensure(vault: &Path, item: &ItemRef) -> Result<PathBuf, String> {
    if let Some(dir) = find(vault, item)? {
        return Ok(dir);
    }
    let base = vault.join(item.kind.dir());
    fs::create_dir_all(&base).map_err(|_| "cannot create item folders")?;
    let dir = free_dir(&base, &desired_name(item));
    fs::create_dir(&dir).map_err(|_| "cannot create item folder")?;
    write_marker(
        &dir,
        &Marker {
            version: 1,
            kind: item.kind,
            id: item.id.clone(),
            references: Vec::new(),
        },
    )?;
    Ok(dir)
}

/// A folder name not yet used: `name`, `name (2)`… (no extension split).
fn free_dir(base: &Path, name: &str) -> PathBuf {
    let candidate = base.join(name);
    if !candidate.exists() {
        return candidate;
    }
    (2..)
        .map(|n| base.join(format!("{name} ({n})")))
        .find(|p| !p.exists())
        .expect("unbounded counter")
}

/// `name`, or `name (2)`, `name (3)`… keeping the extension last.
pub fn free_path(dir: &Path, name: &str, taken: impl Fn(&Path) -> bool) -> PathBuf {
    let candidate = dir.join(name);
    if !taken(&candidate) {
        return candidate;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !taken(p))
        .expect("unbounded counter")
}
