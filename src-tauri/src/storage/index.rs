//! Preflight before transactional replacement; indexing never rewrites Markdown.
use super::*;
use crate::db::NoteIndexEntry;
use std::collections::HashMap;

impl Storage {
    pub async fn rebuild_from_vault(&self) -> Result<RebuildStats> {
        let _operation = self.mutation_permit().await?;
        let _writer = self.note_writes.lock().await;
        let plan = self.preflight_note_index().await?;
        self.db.replace_note_index(&plan.entries)?;
        Ok(plan.stats)
    }

    /// Caller holds permit -> note_writes. This reads/allocates but publishes nothing.
    async fn preflight_note_index(&self) -> Result<NoteIndexPlan> {
        let prior: HashMap<_, _> = self
            .db
            .list_notes()?
            .into_iter()
            .map(|note| (note.path.clone(), note))
            .collect();
        let mut files = Vec::new();
        for sub in ["notes", "daily"] {
            collect_md_files(&self.vault.join(sub), &mut files).await?;
        }
        files.sort();
        let mut snapshots = Vec::new();
        let mut envelope_ids = HashMap::new();
        let mut skipped = HashMap::new();
        let mut stats = RebuildStats {
            notes_indexed: 0,
            links_indexed: 0,
            notes_skipped: 0,
        };
        for path in files {
            let relative = self.relative_note_path(&path)?;
            let snapshot = match self.read_note_snapshot(&path).await {
                Ok(snapshot) => snapshot,
                Err(error)
                    if error
                        .downcast_ref::<io::Error>()
                        .is_some_and(|e| e.kind() == io::ErrorKind::InvalidData) =>
                {
                    tracing::warn!("note preflight: invalid UTF-8 in {}", path.display());
                    stats.notes_skipped += 1;
                    skipped.insert(relative, error);
                    continue;
                }
                Err(error) => return Err(error.context(format!("indexing {}", relative))),
            };
            if let Some(id) = snapshot.envelope_id {
                ensure_unique_id(&mut envelope_ids, id, &relative)?;
            }
            snapshots.push(snapshot);
        }
        let prior_by_id: HashMap<_, _> = prior.values().map(|note| (note.id, note)).collect();
        let mut reserved = envelope_ids.clone();
        // Reserve all legitimate prior identities before allocating any fallback,
        // including priors whose filenames sort after a colliding candidate.
        for snapshot in &snapshots {
            if snapshot.envelope_id.is_none() {
                if let Some(note) = prior
                    .get(&snapshot.entry.note.path)
                    .filter(|note| !envelope_ids.contains_key(&note.id))
                {
                    ensure_unique_id(&mut reserved, note.id, &note.path)?;
                }
            }
        }
        let mut entries = Vec::with_capacity(snapshots.len());
        let mut ids = HashMap::new();
        for mut snapshot in snapshots {
            let path = &snapshot.entry.note.path;
            if snapshot.envelope_id.is_some() {
                if let Some(note) = prior_by_id.get(&snapshot.entry.note.id) {
                    snapshot.entry.note.created_at = note.created_at;
                }
            } else if let Some(note) = prior
                .get(path)
                .filter(|note| !envelope_ids.contains_key(&note.id))
            {
                snapshot.entry.note.id = note.id;
                snapshot.entry.note.created_at = note.created_at;
            } else {
                snapshot.entry.note.id = allocate_legacy_id(path, &mut reserved)?;
            }
            let entry = snapshot.entry;
            ensure_unique_id(&mut ids, entry.note.id, &entry.note.path)?;
            stats.notes_indexed += 1;
            stats.links_indexed += entry.links.len() as u32;
            entries.push(entry);
        }
        Ok(NoteIndexPlan {
            entries,
            stats,
            skipped,
        })
    }

    fn relative_note_path(&self, path: &Path) -> Result<String> {
        Ok(path
            .strip_prefix(&self.vault)?
            .to_str()
            .context("note path is not UTF-8")?
            .replace('\\', "/"))
    }

    /// Same reservations and ordering as rebuild, including unindexed disk claims.
    /// Never re-read a selected file or publish the other entries in the plan.
    pub(super) async fn import_note_index_entry(&self, relative: &str) -> Result<NoteIndexEntry> {
        let mut plan = self.preflight_note_index().await?;
        if let Some(error) = plan.skipped.remove(relative) {
            return Err(error.context(format!("indexing {}", relative)));
        }
        plan.entries
            .into_iter()
            .find(|entry| entry.note.path == relative)
            .context("note_file_missing_or_moved")
    }

    async fn read_note_snapshot(&self, path: &Path) -> Result<NoteSnapshot> {
        let relative = self.relative_note_path(path)?;
        let raw = fs::read_to_string(path).await?;
        let document = NoteFile::parse(&raw)?;
        let metadata = fs::metadata(path).await?;
        let updated_at = metadata
            .modified()
            .ok()
            .map(Into::into)
            .unwrap_or_else(Utc::now);
        let created_at = metadata
            .created()
            .ok()
            .map(Into::into)
            .unwrap_or(updated_at);
        let body = document.body;
        let note = Note {
            // Headerless snapshots have no publishable identity until allocation.
            id: document.id.unwrap_or_else(Uuid::nil),
            title: first_heading(body)
                .or_else(|| path_stem(&relative))
                .unwrap_or_else(|| "(untitled)".into()),
            path: relative,
            tags: extract_tags(body),
            created_at,
            updated_at,
        };
        Ok(NoteSnapshot {
            envelope_id: document.id,
            entry: NoteIndexEntry {
                note,
                body: body.to_string(),
                links: extract_wikilinks(body),
            },
        })
    }
}

// Identity claims and indexed bodies must come from the same read, even if
// another process replaces a file while the rest of the vault is being scanned.
struct NoteIndexPlan {
    entries: Vec<NoteIndexEntry>,
    stats: RebuildStats,
    skipped: HashMap<String, anyhow::Error>,
}

struct NoteSnapshot {
    envelope_id: Option<Uuid>,
    entry: NoteIndexEntry,
}

fn allocate_legacy_id(path: &str, reserved: &mut HashMap<Uuid, String>) -> Result<Uuid> {
    let mut generation = 0u64;
    loop {
        let candidate = note_file::legacy_id_gen(path, generation);
        if let std::collections::hash_map::Entry::Vacant(entry) = reserved.entry(candidate) {
            if generation > 0 {
                tracing::warn!("note preflight: legacy fallback for {} uses generation {} to avoid a reserved identity", path, generation);
            }
            entry.insert(path.to_string());
            return Ok(candidate);
        }
        generation = generation
            .checked_add(1)
            .context("legacy identity generations exhausted")?;
    }
}

fn ensure_unique_id(ids: &mut HashMap<Uuid, String>, id: Uuid, path: &str) -> Result<()> {
    if let Some(other_path) = ids.insert(id, path.to_string()) {
        return Err(
            anyhow::Error::new(crate::note_errors::NoteIdentityConflict).context(format!(
                "duplicate note UUID {} in {} and {}; index unchanged",
                id, other_path, path
            )),
        );
    }
    Ok(())
}

/// Skip symlinks so imports cannot walk outside the vault or recurse in cycles.
pub(super) async fn collect_md_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let mut entries = match fs::read_dir(&current).await {
            Ok(e) => e,
            Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            let ft = entry.file_type().await?;
            if ft.is_symlink() {
                continue;
            }
            let path = entry.path();
            if ft.is_dir() {
                stack.push(path);
            } else if ft.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
                out.push(path);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn parsed_snapshot_keeps_identity_and_body_from_the_same_read() {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Db::open(&dir.path().join("index.db")).unwrap());
        let storage = Storage::new(dir.path().into(), db);
        let path = dir.path().join("note.md");
        let original_id = Uuid::new_v4();
        fs::write(&path, NoteFile::new_document(original_id, "# Original"))
            .await
            .unwrap();
        let snapshot = storage.read_note_snapshot(&path).await.unwrap();
        fs::write(
            &path,
            NoteFile::new_document(Uuid::new_v4(), "# Replacement"),
        )
        .await
        .unwrap();
        assert_eq!(snapshot.envelope_id, Some(original_id));
        let entry = snapshot.entry;
        assert_eq!(entry.note.id, original_id);
        assert_eq!(entry.body, "# Original");
    }
}
