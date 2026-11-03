//! Meeting ↔ activity links (spec 0105 P5): one record per pair in
//! `.coxinha/links.json`, read from both ends.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub session: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LinksFile {
    version: u32,
    links: Vec<Link>,
}

fn path(vault: &Path) -> std::path::PathBuf {
    vault.join(".coxinha/links.json")
}

fn read(vault: &Path) -> Result<LinksFile, String> {
    match fs::read(path(vault)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "cannot parse links".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LinksFile {
            version: 1,
            links: Vec::new(),
        }),
        Err(_) => Err("cannot read links".into()),
    }
}

fn write(vault: &Path, file: &LinksFile) -> Result<(), String> {
    let dir = vault.join(".coxinha");
    fs::create_dir_all(&dir).map_err(|_| "cannot create links directory")?;
    let bytes = serde_json::to_vec_pretty(file).map_err(|_| "cannot encode links")?;
    let mut tmp = tempfile::NamedTempFile::new_in(&dir).map_err(|_| "cannot create links file")?;
    tmp.write_all(&bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "cannot sync links")?;
    tmp.persist(path(vault))
        .map_err(|_| "cannot atomically replace links")?;
    #[cfg(unix)]
    File::open(&dir)
        .and_then(|d| d.sync_all())
        .map_err(|_| "cannot sync links directory")?;
    Ok(())
}

/// Links of a session, of a note, or both filters at once.
pub fn list(vault: &Path, session: Option<&str>, note: Option<&str>) -> Result<Vec<Link>, String> {
    let _guard = LOCK.lock().map_err(|_| "links lock poisoned")?;
    Ok(read(vault)?
        .links
        .into_iter()
        .filter(|l| session.is_none_or(|s| l.session == s))
        .filter(|l| note.is_none_or(|n| l.note == n))
        .collect())
}

pub fn add(vault: &Path, session: &str, note: &str) -> Result<(), String> {
    super::folder::valid_id(session)?;
    super::folder::valid_id(note)?;
    let _guard = LOCK.lock().map_err(|_| "links lock poisoned")?;
    let mut file = read(vault)?;
    if file
        .links
        .iter()
        .any(|l| l.session == session && l.note == note)
    {
        return Ok(());
    }
    file.version = 1;
    file.links.push(Link {
        session: session.to_string(),
        note: note.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    write(vault, &file)
}

pub fn remove(vault: &Path, session: &str, note: &str) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "links lock poisoned")?;
    let mut file = read(vault)?;
    let before = file.links.len();
    file.links
        .retain(|l| !(l.session == session && l.note == note));
    if file.links.len() == before {
        return Ok(());
    }
    file.version = 1;
    write(vault, &file)
}
