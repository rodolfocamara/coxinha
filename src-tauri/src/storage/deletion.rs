//! The caller supplies a canonical-library protection query, never a UI assertion.
use super::*;

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
            fs::remove_file(self.vault.join(&note.path))
                .await
                .map_err(continuity::note_file_error)?;
        }
        self.db.delete_note(id)?;
        Ok(())
    }
}
