//! Typed publication outcomes; text is never used to decide durable state.
use crate::note_errors::{NoteIdentityConflict, NoteMetadataError};

#[derive(Debug, thiserror::Error)]
pub(super) enum Refusal {
    #[error("session_note_conflict")]
    Conflict,
    #[error("session_note_missing")]
    Missing,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PublicationError {
    #[error("session_note_conflict")]
    Conflict(#[source] anyhow::Error),
    #[error("session_note_missing")]
    Missing,
    #[error("{0}")]
    Transient(#[source] anyhow::Error),
}

impl From<anyhow::Error> for PublicationError {
    fn from(error: anyhow::Error) -> Self {
        if matches!(error.downcast_ref::<Refusal>(), Some(Refusal::Missing)) {
            Self::Missing
        } else if error.is::<Refusal>()
            || error.is::<NoteIdentityConflict>()
            || error.is::<NoteMetadataError>()
        {
            Self::Conflict(error)
        } else {
            Self::Transient(error)
        }
    }
}

impl PublicationError {
    pub(crate) fn persistent_code(&self) -> Option<&'static str> {
        match self {
            Self::Conflict(_) => Some("session_note_conflict"),
            Self::Missing => Some("session_note_missing"),
            Self::Transient(_) => None,
        }
    }

    pub(crate) fn into_ipc(self) -> String {
        match self {
            // Metadata parser chains must pass through the existing safe boundary.
            Self::Conflict(error) | Self::Transient(error) => crate::note_errors::ipc_error(error),
            Self::Missing => "session_note_missing".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_typed_refusals_persist_and_parser_details_are_redacted() {
        for message in [
            "session_note_conflict",
            "session_note_missing",
            "library busy",
            "desktop shutdown committed",
            "IO failure",
        ] {
            let error = PublicationError::from(anyhow::anyhow!("{message}"));
            assert!(matches!(error, PublicationError::Transient(_)));
            assert_eq!(error.persistent_code(), None);
            assert_eq!(error.into_ipc(), message);
        }
        let error = PublicationError::from(anyhow::Error::new(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "denied",
        )));
        assert_eq!(error.persistent_code(), None);
        let error = PublicationError::from(
            anyhow::Error::new(Refusal::Missing).context("complete file absent"),
        );
        assert_eq!(error.persistent_code(), Some("session_note_missing"));
        let error = PublicationError::from(anyhow::Error::new(Refusal::Conflict));
        assert_eq!(error.persistent_code(), Some("session_note_conflict"));
        let error = PublicationError::from(
            anyhow::Error::new(NoteMetadataError(anyhow::anyhow!("PRIVATE YAML SCALAR")))
                .context("verifying session note"),
        );
        assert_eq!(error.persistent_code(), Some("session_note_conflict"));
        let ipc = error.into_ipc();
        assert!(ipc.starts_with("note_file_invalid_metadata\n"));
        assert!(!ipc.contains("PRIVATE YAML SCALAR"));
    }
}
