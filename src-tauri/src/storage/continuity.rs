//! Shared indexed-file continuity guard. Callers hold note_writes; this helper never locks it.
use super::*;

pub(super) fn note_file_error(error: io::Error) -> anyhow::Error {
    if error.kind() == io::ErrorKind::NotFound {
        anyhow::anyhow!("note_file_missing_or_moved")
    } else {
        error.into()
    }
}

impl Storage {
    pub(super) async fn read_indexed_file(&self, note: &Note) -> Result<String> {
        fs::read_to_string(self.vault.join(&note.path))
            .await
            .map_err(note_file_error)
    }

    pub(super) fn verify_indexed_file<'a>(
        &self,
        note: &Note,
        raw: &'a str,
    ) -> Result<NoteFile<'a>> {
        let document = NoteFile::parse(raw)?;
        document.ensure_identity(note.id)?;
        if document.id.is_none() {
            let indexed = self.db.indexed_note_body(note.id).unwrap_or(None);
            anyhow::ensure!(
                indexed.as_deref() == Some(document.body),
                "note_file_changed_externally"
            );
        }
        Ok(document)
    }
}
