//! Where the app keeps its data, resolved like the GUI does.
use std::path::PathBuf;

pub const IDENTIFIER: &str = "br.dev.coxinha.app";

#[derive(Debug, Clone, PartialEq)]
pub struct Paths {
    pub vault: PathBuf,
    /// Tauri's app data dir: `<data_dir>/br.dev.coxinha.app`.
    pub data: PathBuf,
}

impl Paths {
    pub fn library(&self) -> PathBuf {
        self.data.join("meeting-library")
    }
    pub fn meetings_db(&self) -> PathBuf {
        self.library().join("meetings.db")
    }
    pub fn profiles_db(&self) -> PathBuf {
        self.library().join("private/profiles.db")
    }
    pub fn outlook_cache(&self) -> PathBuf {
        self.data.join("outlook-cache.json")
    }
    pub fn index_db(&self) -> PathBuf {
        self.vault.join(".coxinha/index.db")
    }
}

/// `--vault`/`--data` win; otherwise `COXINHA_VAULT` or `~/coxinha`, and the
/// platform data dir (`XDG_DATA_HOME` on Linux) as Tauri resolves it.
pub fn resolve(vault: Option<&str>, data: Option<&str>) -> Result<Paths, String> {
    let vault = match vault {
        Some(v) => PathBuf::from(v),
        None => crate::config::default_vault_root().map_err(|e| e.to_string())?,
    };
    let data = match data {
        Some(d) => PathBuf::from(d),
        None => directories::BaseDirs::new()
            .ok_or("home directory unavailable")?
            .data_dir()
            .join(IDENTIFIER),
    };
    Ok(Paths { vault, data })
}
