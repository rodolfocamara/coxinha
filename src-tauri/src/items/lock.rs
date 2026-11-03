//! Cross-process advisory locks under `.coxinha/`: the app and `Coxinha cli`
//! both read-modify-write the same marker and links files.
use std::fs::{self, File, OpenOptions};
use std::path::Path;

/// Held until the returned file is dropped.
pub fn exclusive(vault: &Path, name: &str) -> Result<File, String> {
    let dir = vault.join(".coxinha");
    fs::create_dir_all(&dir).map_err(|_| "cannot create lock directory")?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join(name))
        .map_err(|_| "cannot open lock file")?;
    file.lock().map_err(|_| "cannot take lock")?;
    Ok(file)
}
