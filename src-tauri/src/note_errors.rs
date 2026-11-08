//! Typed note-file refusals: stable IPC guidance without classifying arbitrary error text.
use std::fmt;

mod metadata;
pub(crate) use metadata::MetadataIssue;

#[derive(Debug)]
pub(crate) struct NoteIdentityConflict;

impl fmt::Display for NoteIdentityConflict {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("note_file_identity_conflict")
    }
}
impl std::error::Error for NoteIdentityConflict {}

#[derive(Debug)]
pub(crate) struct NoteMetadataError(pub anyhow::Error);

impl fmt::Display for NoteMetadataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}
impl std::error::Error for NoteMetadataError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.0.as_ref())
    }
}

pub(crate) fn ipc_error(error: anyhow::Error) -> String {
    let (code, detail) = if let Some(metadata) = error.downcast_ref::<NoteMetadataError>() {
        // Contexts above this marker are controlled operation/path descriptions.
        // Never serialize the parser source chain: serde_yaml can include private scalars.
        let mut parts: Vec<_> = error
            .chain()
            .take_while(|cause| !cause.is::<NoteMetadataError>())
            .map(ToString::to_string)
            .collect();
        parts.push(metadata::safe_detail(&metadata.0));
        ("note_file_invalid_metadata", parts.join(": "))
    } else if error.is::<NoteIdentityConflict>() {
        let detail = error
            .chain()
            .filter(|cause| !cause.is::<NoteIdentityConflict>())
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(": ");
        let detail = if detail.is_empty() {
            "note identity does not match the indexed identity".into()
        } else {
            detail
        };
        ("note_file_identity_conflict", detail)
    } else {
        return format!("{error:#}");
    };
    tracing::warn!(code, detail = %detail, "note file operation refused");
    format!("{code}\n{detail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_refusals_keep_diagnostics_but_map_through_context_at_ipc() {
        let metadata: anyhow::Error =
            NoteMetadataError(anyhow::anyhow!("invalid YAML at line 4")).into();
        let metadata = metadata.context("indexing notes/broken.md");
        assert!(format!("{metadata:#}").contains("invalid YAML at line 4"));
        let message = ipc_error(metadata);
        assert_eq!(message.lines().next(), Some("note_file_invalid_metadata"));
        assert!(message.contains("notes/broken.md"));
        assert!(message.contains("invalid or unsupported note metadata"));
        let conflict =
            anyhow::Error::new(NoteIdentityConflict).context("duplicate note UUID in a and b");
        assert!(format!("{conflict:#}").contains("duplicate note UUID"));
        assert_eq!(
            ipc_error(conflict),
            "note_file_identity_conflict\nduplicate note UUID in a and b"
        );
    }

    #[test]
    fn unrelated_errors_are_never_classified_by_text() {
        for message in [
            "disk full",
            "SQLite failure",
            "invalid note metadata",
            "duplicate note UUID",
        ] {
            assert_eq!(ipc_error(anyhow::anyhow!("{message}")), message);
        }
        let io: anyhow::Error =
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied").into();
        assert_eq!(ipc_error(io), "denied");
    }
}

#[cfg(test)]
mod diagnostic_tests;
