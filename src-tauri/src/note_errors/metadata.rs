//! Safe categories retain actionable parser diagnostics without YAML scalar values.
use std::fmt;

#[derive(Debug)]
pub(crate) enum MetadataIssue {
    InvalidYaml,
    Mapping,
    Version,
    MissingId,
    InvalidId,
    NilId,
    MergeKeys,
    Unterminated,
}

impl fmt::Display for MetadataIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidYaml => "invalid note metadata",
            Self::Mapping => "note metadata must be a mapping",
            Self::Version => "unsupported note metadata version",
            Self::MissingId => "note metadata requires a UUID id",
            Self::InvalidId => "invalid note metadata UUID",
            Self::NilId => "nil note metadata UUID",
            Self::MergeKeys => "YAML merge keys are unsupported",
            Self::Unterminated => "unterminated note metadata envelope",
        })
    }
}
impl std::error::Error for MetadataIssue {}

pub(super) fn safe_detail(error: &anyhow::Error) -> String {
    let category = error
        .downcast_ref::<MetadataIssue>()
        .map(ToString::to_string)
        .unwrap_or_else(|| "invalid or unsupported note metadata".into());
    match error
        .downcast_ref::<serde_yaml::Error>()
        .and_then(serde_yaml::Error::location)
    {
        // YAML begins after the opening delimiter, on the file's second line.
        Some(location) => format!(
            "{} at line {}, column {}",
            category,
            location.line() + 1,
            location.column()
        ),
        None => category,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_metadata_errors_never_expose_untrusted_scalar_diagnostics() {
        let error = anyhow::anyhow!("PRIVATE_SCALAR from an unknown parser diagnostic");
        assert_eq!(safe_detail(&error), "invalid or unsupported note metadata");
    }

    #[test]
    fn explicit_validation_categories_keep_safe_cause_without_private_sources() {
        for (issue, expected) in [
            (MetadataIssue::Version, "unsupported note metadata version"),
            (MetadataIssue::MissingId, "note metadata requires a UUID id"),
            (MetadataIssue::InvalidId, "invalid note metadata UUID"),
            (MetadataIssue::NilId, "nil note metadata UUID"),
            (MetadataIssue::MergeKeys, "YAML merge keys are unsupported"),
            (
                MetadataIssue::Unterminated,
                "unterminated note metadata envelope",
            ),
        ] {
            let error = anyhow::anyhow!("PRIVATE_SCALAR").context(issue);
            assert_eq!(safe_detail(&error), expected);
        }
    }
}
