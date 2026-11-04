//! Exclusive, recoverable publication of notes reserved in the canonical library.
//! Caller owns the outer mutation permit across reservation, publication and binding.
use super::*;
use coxinha_core::store::session::{note_intent::PersonalNoteIntent, PersonalNoteRef};
use sha2::{Digest, Sha256};
use std::io::Write;

mod errors;
pub(crate) use errors::PublicationError;
use errors::Refusal;

impl Storage {
    pub(crate) async fn publish_session_note(
        &self,
        intent: &PersonalNoteIntent,
        _permit: &tokio::sync::RwLockReadGuard<'_, ()>,
    ) -> std::result::Result<PersonalNoteRef, PublicationError> {
        self.publish_session_note_inner(intent)
            .await
            .map_err(Into::into)
    }

    async fn publish_session_note_inner(
        &self,
        intent: &PersonalNoteIntent,
    ) -> Result<PersonalNoteRef> {
        let _writer = self.note_writes.lock().await;
        let expected = format!("notes/session-{}.md", intent.note_id);
        anyhow::ensure!(intent.relative_path == expected, Refusal::Conflict);
        // Ordinary complete-note read, not a global recovery/duplicate scan.
        // A missing indexed file falls back to full recovery; tamper fails closed.
        if intent.state == "complete" {
            if let Some(indexed) = self.db.get_note(intent.note_id)? {
                let reference = PersonalNoteRef {
                    id: indexed.id,
                    relative_path: indexed.path,
                };
                reference.validate().map_err(|_| Refusal::Conflict)?;
                let path = self.vault.join(&reference.relative_path);
                match self.verify_session_path(&path).await {
                    Ok(()) => match fs::read_to_string(path).await {
                        Ok(raw) => {
                            verify_owned_document(intent, &raw)?;
                            return Ok(reference);
                        }
                        Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                        Err(e) => return Err(e.into()),
                    },
                    Err(e)
                        if e.downcast_ref::<io::Error>()
                            .is_some_and(|e| e.kind() == io::ErrorKind::NotFound) => {}
                    Err(e) => return Err(e),
                }
            }
        }
        let mut files = Vec::new();
        for sub in ["notes", "daily"] {
            index::collect_md_files(&self.vault.join(sub), &mut files).await?;
        }
        let indexed = self.db.get_note(intent.note_id)?;
        let mut owned = Vec::new();
        for file in files {
            let raw = match fs::read_to_string(&file).await {
                Ok(raw) => raw,
                Err(error) => {
                    // Known owner I/O failures are transient, never ownership conflicts.
                    if file == self.vault.join(&intent.relative_path)
                        || indexed
                            .as_ref()
                            .is_some_and(|note| file == self.vault.join(&note.path))
                    {
                        return Err(error.into());
                    }
                    continue; // unrelated unreadable content must not disable recovery
                }
            };
            if NoteFile::parse(&raw).ok().and_then(|d| d.id) == Some(intent.note_id) {
                owned.push((file, raw));
            }
        }
        anyhow::ensure!(owned.len() <= 1, Refusal::Conflict);
        let (path, raw) = match owned.pop() {
            Some(found) => found,
            None => {
                anyhow::ensure!(intent.state != "complete", Refusal::Missing);
                let path = self.vault.join(&intent.relative_path);
                self.verify_session_path(&path).await?;
                let document = reserved_document(intent);
                let publication = path.clone();
                // A complete temporary inode is linked exclusively. Existing targets,
                // including symlinks, are never replaced or removed on any error.
                tokio::task::spawn_blocking(move || -> Result<()> {
                    let parent = publication.parent().context(Refusal::Conflict)?;
                    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
                    temporary.write_all(document.as_bytes())?;
                    temporary.as_file().sync_all()?;
                    temporary.persist_noclobber(&publication).map_err(|e| {
                        if e.error.kind() == io::ErrorKind::AlreadyExists {
                            anyhow::Error::new(Refusal::Conflict)
                        } else {
                            e.error.into()
                        }
                    })?;
                    #[cfg(unix)]
                    std::fs::File::open(parent)?.sync_all()?;
                    Ok(())
                })
                .await??;
                let raw = fs::read_to_string(&path).await?;
                (path, raw)
            }
        };
        #[cfg(test)]
        crash_boundary("published");
        self.verify_session_path(&path).await?;
        verify_owned_document(intent, &raw)?;
        let relative = path
            .strip_prefix(&self.vault)?
            .to_str()
            .context(Refusal::Conflict)?
            .replace('\\', "/");
        let reference = PersonalNoteRef {
            id: intent.note_id,
            relative_path: relative.clone(),
        };
        reference.validate().map_err(|_| Refusal::Conflict)?;
        let existing = self.db.get_note(intent.note_id)?;
        if let Some(other) = self.db.get_note_by_path(&relative)? {
            anyhow::ensure!(other.id == intent.note_id, Refusal::Conflict);
        }
        if let Some(previous) = &existing {
            // A stale index at the old path is repaired only for this exact UUID.
            anyhow::ensure!(
                previous.path == relative
                    || !fs::try_exists(self.vault.join(&previous.path)).await?,
                Refusal::Conflict
            );
        }
        let body = NoteFile::parse(&raw)?.body;
        let now = Utc::now();
        let note = Note {
            id: intent.note_id,
            title: first_heading(body).unwrap_or_else(|| "My notes".into()),
            path: relative.clone(),
            tags: extract_tags(body),
            created_at: existing.as_ref().map(|n| n.created_at).unwrap_or(now),
            updated_at: fs::metadata(&path)
                .await?
                .modified()
                .map(Into::into)
                .unwrap_or(now),
        };
        self.db.publish_reserved_note_index(
            &note,
            body,
            &extract_wikilinks(body),
            existing.as_ref().map(|n| n.path.as_str()),
        )?;
        #[cfg(test)]
        crash_boundary("indexed");
        Ok(reference)
    }

    async fn verify_session_path(&self, path: &Path) -> Result<()> {
        let relative = path.strip_prefix(&self.vault)?;
        let parts: Vec<_> = relative.components().collect();
        anyhow::ensure!(
            parts.len() >= 2 && matches!(parts[0].as_os_str().to_str(), Some("notes" | "daily")),
            Refusal::Conflict
        );
        let mut current = self.vault.clone();
        for part in parts {
            anyhow::ensure!(
                matches!(part, std::path::Component::Normal(_)),
                Refusal::Conflict
            );
            current.push(part);
            match fs::symlink_metadata(&current).await {
                Ok(metadata) => {
                    anyhow::ensure!(!metadata.file_type().is_symlink(), Refusal::Conflict)
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound && current == path => (),
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
}

fn digest(intent: &PersonalNoteIntent) -> String {
    format!("{:x}", Sha256::digest(intent.initial_body.as_bytes()))
}
fn quote(value: &str) -> String {
    serde_json::to_string(value).expect("string serialization cannot fail")
}
fn reserved_document(intent: &PersonalNoteIntent) -> String {
    format!("---\ncoxinha-note: 1\nid: {}\ncoxinha-session: {}\ncoxinha-intent: {}\ncoxinha-reserved-path: {}\ncoxinha-initial-sha256: {}\n---\n{}",
        quote(&intent.note_id.to_string()),quote(&intent.session_id),quote(&intent.token),quote(&intent.relative_path),quote(&digest(intent)),intent.initial_body)
}
fn verify_owned_document(intent: &PersonalNoteIntent, raw: &str) -> Result<()> {
    let document = NoteFile::parse(raw)?;
    anyhow::ensure!(document.id == Some(intent.note_id), Refusal::Conflict);
    for (key, expected) in [
        ("coxinha-session", intent.session_id.clone()),
        ("coxinha-intent", intent.token.clone()),
        ("coxinha-reserved-path", intent.relative_path.clone()),
        ("coxinha-initial-sha256", digest(intent)),
    ] {
        anyhow::ensure!(
            document.metadata_string(key).as_deref() == Some(&expected),
            Refusal::Conflict
        );
    }
    // The digest records the committed initial content intent. Current body is
    // deliberately NOT compared: user edits after publication always win.
    Ok(())
}

#[cfg(test)]
fn crash_boundary(stage: &str) {
    if std::env::var("COXINHA_SESSION_CRASH_ROOT").is_ok()
        && std::env::var("COXINHA_SESSION_CRASH_STAGE").as_deref() == Ok(stage)
    {
        std::process::exit(0);
    }
}
#[cfg(test)]
mod review_tests;
#[cfg(test)]
mod tests;
