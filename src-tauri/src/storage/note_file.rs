//! Reserved YAML envelope. Keep raw header slices so edits cannot normalize metadata.
use crate::note_errors::MetadataIssue;
use anyhow::{ensure, Context, Result};
use serde_yaml::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(super) struct NoteFile<'a> {
    header: Option<&'a str>,
    pub id: Option<Uuid>,
    pub body: &'a str,
}

impl<'a> NoteFile<'a> {
    pub fn parse(raw: &'a str) -> Result<Self> {
        Self::parse_inner(raw).map_err(|error| crate::note_errors::NoteMetadataError(error).into())
    }

    fn parse_inner(raw: &'a str) -> Result<Self> {
        let mut lines = raw.split_inclusive('\n');
        let opening = lines.next().unwrap_or("");
        let marker = lines.next().unwrap_or("");
        if !matches!(opening, "---\n" | "---\r\n") || !marker.starts_with("coxinha-note:") {
            return Ok(Self {
                header: None,
                id: None,
                body: raw,
            });
        }
        let mut offset = opening.len() + marker.len();
        for line in lines {
            if matches!(line, "---\n" | "---\r\n") {
                let yaml = &raw[opening.len()..offset];
                let value: Value =
                    serde_yaml::from_str(yaml).context(MetadataIssue::InvalidYaml)?;
                let mapping = value.as_mapping().context(MetadataIssue::Mapping)?;
                reject_merge_keys(&value)?;
                ensure!(
                    mapping.get("coxinha-note").and_then(Value::as_u64) == Some(1),
                    MetadataIssue::Version
                );
                let id = mapping
                    .get("id")
                    .and_then(Value::as_str)
                    .context(MetadataIssue::MissingId)?;
                let id = Uuid::parse_str(id).context(MetadataIssue::InvalidId)?;
                ensure!(!id.is_nil(), MetadataIssue::NilId);
                let end = offset + line.len();
                return Ok(Self {
                    header: Some(&raw[..end]),
                    id: Some(id),
                    body: &raw[end..],
                });
            }
            offset += line.len();
        }
        anyhow::bail!(MetadataIssue::Unterminated)
    }

    pub fn ensure_identity(&self, expected: Uuid) -> Result<()> {
        if self.id.is_some_and(|id| id != expected) {
            return Err(crate::note_errors::NoteIdentityConflict.into());
        }
        Ok(())
    }

    pub fn metadata_string(&self, key: &str) -> Option<String> {
        let header = self.header?;
        let start = header.find('\n')? + 1;
        let end = header.rfind("---")?;
        let value: Value = serde_yaml::from_str(&header[start..end]).ok()?;
        value.as_mapping()?.get(key)?.as_str().map(str::to_owned)
    }

    pub fn new_document(id: Uuid, body: &str) -> String {
        format!("---\ncoxinha-note: 1\nid: {id}\n---\n{body}")
    }

    pub fn with_body(&self, id: Uuid, body: &str) -> String {
        match self.header {
            Some(header) => format!("{header}{body}"),
            None => Self::new_document(id, body),
        }
    }
}

fn reject_merge_keys(value: &Value) -> Result<()> {
    match value {
        Value::Mapping(map) => {
            ensure!(
                !map.contains_key(Value::String("<<".into())),
                MetadataIssue::MergeKeys
            );
            for (key, value) in map {
                reject_merge_keys(key)?;
                reject_merge_keys(value)?;
            }
        }
        Value::Sequence(values) => {
            for value in values {
                reject_merge_keys(value)?;
            }
        }
        Value::Tagged(value) => reject_merge_keys(&value.value)?,
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn legacy_id(relative_path: &str) -> Uuid {
    legacy_id_gen(relative_path, 0)
}

pub(super) fn legacy_id_gen(relative_path: &str, generation: u64) -> Uuid {
    let mut hash = Sha256::new();
    hash.update(b"coxinha:legacy-note:v1\0");
    hash.update(relative_path.as_bytes());
    if generation != 0 {
        hash.update(b"\0generation:");
        hash.update(generation.to_string().as_bytes());
    }
    let digest = hash.finalize();
    let mut bytes: [u8; 16] = digest[..16].try_into().unwrap();
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}
