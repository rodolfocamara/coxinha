//! The caller supplies a canonical-library protection query, never a UI assertion.
use super::*;
use super::index::collect_md_files;
use chrono::Local;

#[derive(Debug, thiserror::Error)]
#[error("session_note_delete_requires_detach")]
struct SessionNoteDeleteRequiresDetach;

impl Storage {
    pub(crate) async fn delete_note_checked<F, Fut>(&self, id: Uuid, protected: F) -> Result<()>
    where
        F: FnOnce(Option<String>) -> Fut,
        Fut: std::future::Future<Output = Result<bool>>,
    {
        // A shared permit would leave a cross-DB check/reservation race. This
        // excludes the whole ensure operation, including its worker reservation.
        // Acquire no writer lock until prior operations/exit have released the gate.
        let _operation = self.operations.write().await;
        anyhow::ensure!(
            !self.shutdown_committed.load(Ordering::Acquire),
            "desktop shutdown committed; mutation rejected"
        );
        let _writer = self.note_writes.lock().await;
        let note = self.db.get_note(id)?;
        if protected(note.as_ref().map(|note| note.path.clone())).await? {
            return Err(SessionNoteDeleteRequiresDetach.into());
        }
        if let Some(note) = note {
            let raw = self.read_indexed_file(&note).await?;
            self.verify_indexed_file(&note, &raw)?;
            self.move_to_trash(&note.path).await?;
        }
        self.db.delete_note(id)?;
        Ok(())
    }

    /// `notes/a.md` goes to `.coxinha/trash/<date>/notes/a.md`, so the trash
    /// keeps where it came from; a taken name gets " (2)".
    async fn move_to_trash(&self, relative: &str) -> Result<()> {
        let day = Local::now().format("%Y-%m-%d").to_string();
        let target = self.vault.join(TRASH).join(day).join(relative);
        let parent = target.parent().context("note path has no folder")?;
        fs::create_dir_all(parent).await?;
        let target = free_path(&target).await?;
        fs::rename(self.vault.join(relative), &target)
            .await
            .map_err(continuity::note_file_error)?;
        Ok(())
    }

    /// Brings a note deleted from Coxinha back from the trash, newest first,
    /// to its old place (spec 0112 P3).
    pub async fn restore_note(&self, id: Uuid) -> Result<Note> {
        let _operation = self.mutation_permit().await?;
        let _writer = self.note_writes.lock().await;
        anyhow::ensure!(self.db.get_note(id)?.is_none(), "note is not deleted");
        let trash = self.vault.join(TRASH);
        let mut days = Vec::new();
        if let Ok(mut entries) = fs::read_dir(&trash).await {
            while let Some(entry) = entries.next_entry().await? {
                if entry.file_type().await?.is_dir() {
                    days.push(entry.path());
                }
            }
        }
        days.sort();
        for day in days.into_iter().rev() {
            for sub in ["notes", "daily"] {
                let mut files = Vec::new();
                collect_md_files(&day.join(sub), &mut files).await?;
                for file in files {
                    let Ok(raw) = fs::read_to_string(&file).await else { continue };
                    if NoteFile::parse(&raw).ok().and_then(|d| d.id) != Some(id) {
                        continue;
                    }
                    let relative = file.strip_prefix(&day)?;
                    let target = free_path(&self.vault.join(relative)).await?;
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent).await?;
                    }
                    fs::rename(&file, &target).await?;
                    let snapshot = self.read_note_snapshot(&target).await?;
                    let entry = snapshot.entry;
                    self.db.save_note(&entry.note, &entry.body, &entry.links)?;
                    return Ok(entry.note);
                }
            }
        }
        anyhow::bail!("note not found in the trash")
    }
}

pub(crate) const TRASH: &str = ".coxinha/trash";

/// The path itself when free, else "name (2).md", "name (3).md"…
async fn free_path(path: &Path) -> Result<PathBuf> {
    if !fs::try_exists(path).await? {
        return Ok(path.to_path_buf());
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("note");
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("md");
    for n in 2.. {
        let candidate = path.with_file_name(format!("{stem} ({n}).{extension}"));
        if !fs::try_exists(&candidate).await? {
            return Ok(candidate);
        }
    }
    unreachable!()
}
