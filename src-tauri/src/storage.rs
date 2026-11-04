//! Vault abstraction. The filesystem is canonical; the DB is an index.
//!
//! Rules:
//! - Each note becomes an `.md` file under `notes/`
//! - Filename = title slug + `-<short id>`
//! - Attachments under `attachments/` (auto WebP compression on paste)
//! - Meetings under `meetings/<id>/` with metadata.json, recording.wav, ...

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::{Context, Result};
use chrono::Utc;
use shared::*;
use tokio::fs;
use uuid::Uuid;

use crate::db::Db;

mod attachments;
mod continuity;
mod deletion;
mod index;
mod markdown;
use attachments::compress_if_image;
use markdown::*;
mod note_file;
mod session_notes;
use note_file::NoteFile;

pub struct Storage {
    vault: PathBuf,
    db: Arc<Db>,
    operations: tokio::sync::RwLock<()>,
    note_writes: tokio::sync::Mutex<()>,
    shutdown_committed: AtomicBool,
}

impl Storage {
    pub fn new(vault: PathBuf, db: Arc<Db>) -> Self {
        Self {
            vault,
            db,
            operations: tokio::sync::RwLock::new(()),
            note_writes: tokio::sync::Mutex::new(()),
            shutdown_committed: AtomicBool::new(false),
        }
    }

    /// Needed by spec 0015 (vault import) and spec 0018 (external
    /// edit conflicts) — both walk the vault path directly.
    #[allow(dead_code)]
    pub fn vault(&self) -> &Path {
        &self.vault
    }

    /// Held until filesystem and index updates complete. Exit takes the exclusive side.
    pub async fn mutation_permit(&self) -> Result<tokio::sync::RwLockReadGuard<'_, ()>> {
        let permit = self.operations.read().await;
        anyhow::ensure!(
            !self.shutdown_committed.load(Ordering::Acquire),
            "desktop shutdown committed; mutation rejected"
        );
        Ok(permit)
    }
    /// Set only while holding the exclusive barrier, after all exit preparation succeeds.
    pub fn commit_shutdown(&self, _barrier: &tokio::sync::RwLockWriteGuard<'_, ()>) {
        self.shutdown_committed.store(true, Ordering::Release);
    }
    pub async fn quiesce(&self) -> tokio::sync::RwLockWriteGuard<'_, ()> {
        self.operations.write().await
    }

    #[cfg(test)]
    pub(crate) fn operation_in_progress(&self) -> bool {
        self.operations.try_write().is_err()
    }

    #[cfg(test)]
    pub(crate) async fn hold_note_writer(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.note_writes.lock().await
    }

    // ---- Notes ----

    pub async fn create_note(&self, title: &str, content: &str) -> Result<Note> {
        let _operation = self.mutation_permit().await?;
        let _writer = self.note_writes.lock().await;
        let id = Uuid::new_v4();
        let now = Utc::now();
        let filename = format!(
            "{}-{}.md",
            slug(title),
            id.simple().to_string().chars().take(6).collect::<String>()
        );
        let rel_path = format!("notes/{}", filename);
        let abs_path = self.vault.join(&rel_path);

        anyhow::ensure!(
            !fs::try_exists(&abs_path).await?,
            "note path already exists"
        );
        atomic_write(&abs_path, NoteFile::new_document(id, content).as_bytes()).await?;

        let note = Note {
            id,
            title: title.to_string(),
            path: rel_path,
            tags: extract_tags(content),
            created_at: now,
            updated_at: now,
        };
        self.db
            .save_note(&note, content, &extract_wikilinks(content))?;
        Ok(note)
    }

    pub async fn update_note(&self, id: Uuid, content: &str) -> Result<Note> {
        let _operation = self.mutation_permit().await?;
        let _writer = self.note_writes.lock().await;
        let note = self
            .db
            .get_note(id)?
            .with_context(|| format!("note {} not found", id))?;
        let abs = self.vault.join(&note.path);
        let raw = self.read_indexed_file(&note).await?;
        let document = self.verify_indexed_file(&note, &raw)?;
        atomic_write(&abs, document.with_body(id, content).as_bytes()).await?;

        let updated = Note {
            title: first_heading(content).unwrap_or(note.title),
            tags: extract_tags(content),
            updated_at: Utc::now(),
            ..note
        };
        self.db
            .save_note(&updated, content, &extract_wikilinks(content))?;
        Ok(updated)
    }

    /// Notes that contain a `[[…]]` pointing at this note. The
    /// match is resolved at query time (case-insensitive) against
    /// the note's current title **and** its filename stem — either
    /// spelling of the wiki-link works.
    pub async fn backlinks(&self, id: Uuid) -> Result<Vec<Note>> {
        let note = self
            .db
            .get_note(id)?
            .with_context(|| format!("note {} not found", id))?;
        let mut keys = vec![note.title.clone()];
        if let Some(stem) = path_stem(&note.path) {
            if stem != note.title {
                keys.push(stem);
            }
        }
        self.db.backlinks_for_keys(&keys)
    }

    /// Returns today's (or `date`'s) daily note, creating the file
    /// from the default template on first use. Idempotent — a second
    /// call on the same day returns the same `Note` without
    /// rewriting the file.
    pub async fn get_or_create_daily_note(&self, date: Option<&str>) -> Result<Note> {
        let _operation = self.mutation_permit().await?;
        let _writer = self.note_writes.lock().await;
        let date_str: String = match date {
            Some(d) => {
                chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                    .with_context(|| format!("invalid date '{}', expected YYYY-MM-DD", d))?;
                d.to_string()
            }
            None => chrono::Local::now().format("%Y-%m-%d").to_string(),
        };

        let rel_path = format!("daily/{}.md", date_str);
        if let Some(existing) = self.db.get_note_by_path(&rel_path)? {
            let raw = self.read_indexed_file(&existing).await?;
            self.verify_indexed_file(&existing, &raw)?;
            return Ok(existing);
        }

        let abs_path = self.vault.join(&rel_path);
        if fs::try_exists(&abs_path).await? {
            let entry = self.import_note_index_entry(&rel_path).await?;
            self.db.save_note(&entry.note, &entry.body, &entry.links)?;
            return Ok(entry.note);
        }
        let content = format!("# {}\n\n## Notes\n\n", date_str);
        let id = Uuid::new_v4();
        atomic_write(&abs_path, NoteFile::new_document(id, &content).as_bytes()).await?;

        let now = Utc::now();
        let note = Note {
            id,
            title: date_str,
            path: rel_path,
            tags: Vec::new(),
            created_at: now,
            updated_at: now,
        };
        self.db
            .save_note(&note, &content, &extract_wikilinks(&content))?;
        Ok(note)
    }

    // Lower-level continuity tests have no library. Production deletion requires
    // the canonical guard through Library::delete_note; there is no raw IPC path.
    #[cfg(test)]
    async fn delete_note(&self, id: Uuid) -> Result<()> {
        self.delete_note_checked(id, |_| async { Ok(false) }).await
    }

    pub async fn list_notes(&self) -> Result<Vec<Note>> {
        self.db.list_notes()
    }

    pub async fn get_note(&self, id: Uuid) -> Result<NoteContent> {
        // Serialize the index lookup and file guard with our own FS/index writes.
        // Reads remain available while the read-only desktop exit barrier is held.
        let _reader = self.note_writes.lock().await;
        let note = self
            .db
            .get_note(id)?
            .with_context(|| format!("note {} not found", id))?;
        let raw = self.read_indexed_file(&note).await?;
        let document = self.verify_indexed_file(&note, &raw)?;
        let markdown = document.body.to_string();
        Ok(NoteContent { note, markdown })
    }

    pub async fn search_notes(&self, query: &str) -> Result<Vec<Note>> {
        self.db.search_notes(query)
    }

    pub async fn list_tags(&self) -> Result<Vec<TagCount>> {
        self.db.list_tags()
    }

    pub async fn list_notes_by_tag(&self, tag: &str) -> Result<Vec<Note>> {
        self.db.list_notes_by_tag(tag)
    }

    // ---- Meetings ----

    pub async fn list_meetings(&self) -> Result<Vec<Meeting>> {
        self.db.list_meetings()
    }

    pub async fn get_meeting(&self, id: Uuid) -> Result<Meeting> {
        self.db
            .get_meeting(id)?
            .with_context(|| format!("meeting {} not found", id))
    }

    pub fn meeting_dir(&self, id: Uuid) -> PathBuf {
        self.vault.join("meetings").join(id.to_string())
    }

    // ---- Attachments ----

    pub async fn save_attachment(&self, filename: &str, bytes: &[u8]) -> Result<String> {
        let _operation = self.mutation_permit().await?;
        let (final_bytes, final_name) = compress_if_image(filename, bytes);

        let stamp = Utc::now().format("%Y-%m-%d-%H%M%S");
        let safe_name = format!("{}-{}", stamp, sanitize(&final_name));
        let rel = format!("attachments/{}", safe_name);
        let abs = self.vault.join(&rel);
        fs::write(&abs, &final_bytes).await?;
        Ok(rel)
    }
}

/// Write `content` to `abs` via `<abs>.coxinha-tmp` + rename so a
/// crash mid-write leaves either the old contents or the new
/// contents — never a truncated file.
///
/// Windows' `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` backs
/// `std::fs::rename`, so the replace-on-exists case is atomic on
/// NTFS. Requires `tmp` and `abs` on the same filesystem; our vault
/// structure guarantees that.
async fn atomic_write(abs: &Path, content: &[u8]) -> Result<()> {
    let tmp = {
        let name = abs
            .file_name()
            .with_context(|| format!("no file name in {}", abs.display()))?
            .to_string_lossy()
            .into_owned();
        let mut t = abs.to_path_buf();
        t.set_file_name(format!("{}.coxinha-tmp", name));
        t
    };
    fs::write(&tmp, content).await?;
    fs::rename(&tmp, abs).await?;
    Ok(())
}

#[cfg(test)]
mod identity_tests;
#[cfg(test)]
mod r3_identity_tests;
#[cfg(test)]
mod r3_regression_tests;
#[cfg(test)]
mod r4_continuity_tests;
#[cfg(test)]
mod r4_lock_tests;
#[cfg(test)]
mod review_fix_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod r5_import_tests;

#[cfg(test)]
mod r5_error_tests;
