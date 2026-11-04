//! Shared service for every generic delete_note IPC caller.
use super::*;
use crate::storage::Storage;
use anyhow::Context;
use std::sync::Arc;
use uuid::Uuid;

// Bound only the read-only worker query, without weakening operation exclusion.
const PROTECTION_QUERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

impl Library {
    pub(crate) async fn delete_note(&self, storage: Arc<Storage>, id: Uuid) -> Result<(), String> {
        let library = self.clone();
        // Once authorized, cancellation cannot release the barrier while a
        // canonical check or filesystem/index deletion is still in progress.
        tauri::async_runtime::spawn(async move {
            storage
                .delete_note_checked(id, move |path| async move {
                    // Dropping ask on timeout closes its reply receiver. The queued
                    // read may finish later, but cannot resume this delete operation.
                    let protected = tokio::time::timeout(
                        PROTECTION_QUERY_TIMEOUT,
                        library.ask(Action::Session(sessions::SessionAction::ProtectsNote(
                            id, path,
                        ))),
                    )
                    .await
                    .map_err(|_| {
                        anyhow::anyhow!("canonical session note protection query timed out")
                    })?
                    .map_err(anyhow::Error::msg)
                    .context("cannot verify canonical session note references")?;
                    protected
                        .as_bool()
                        .context("invalid canonical note protection response")
                })
                .await
                .map_err(crate::note_errors::ipc_error)
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[cfg(test)]
mod tests;
