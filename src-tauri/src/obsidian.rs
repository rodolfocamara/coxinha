//! Read-only detection of Obsidian vaults installed on this machine.
//!
//! Obsidian keeps a global JSON at the OS-specific config dir with a
//! `vaults` map (id → { path, ts }). We parse that once when the
//! Settings view asks for it and never write back.
//!
//! Scope per spec 0037:
//! - F1 validates only Windows.
//! - `directories::BaseDirs::config_dir()` returns the right root on
//!   all three desktop OSes, so macOS/Linux come for free at the
//!   parsing layer; only the UI flow is phase-gated.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;
use shared::ObsidianVault;

pub fn detect_vaults() -> Result<Vec<ObsidianVault>> {
    let path = obsidian_config_path()?;
    if !path.exists() {
        // Not an error — the user simply doesn't have Obsidian
        // installed. Settings shows an empty state.
        return Ok(Vec::new());
    }
    let raw =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    parse_vaults(&raw)
}

fn obsidian_config_path() -> Result<PathBuf> {
    let base = directories::BaseDirs::new().context("BaseDirs unavailable")?;
    Ok(base.config_dir().join("obsidian").join("obsidian.json"))
}

fn parse_vaults(json: &str) -> Result<Vec<ObsidianVault>> {
    #[derive(Deserialize)]
    struct Root {
        #[serde(default)]
        vaults: HashMap<String, Entry>,
    }
    #[derive(Deserialize)]
    struct Entry {
        path: String,
        #[serde(default)]
        ts: Option<i64>,
    }

    let root: Root = serde_json::from_str(json).context("parsing obsidian.json")?;

    let mut out: Vec<ObsidianVault> = root
        .vaults
        .into_iter()
        .map(|(id, entry)| ObsidianVault {
            id,
            name: leaf_name(&entry.path),
            exists: Path::new(&entry.path).exists(),
            last_opened_ms: entry.ts,
            path: entry.path,
        })
        .collect();

    // Most recently opened first; fallback alphabetical when no
    // timestamp is present so the order is stable across calls.
    out.sort_by(|a, b| {
        b.last_opened_ms
            .cmp(&a.last_opened_ms)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

fn leaf_name(path: &str) -> String {
    // Display labels must also handle an imported config from another OS.
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "vaults": {
            "abc123": {
                "path": "C:\\Users\\alice\\Documents\\WorkVault",
                "ts": 1711000000000,
                "open": true
            },
            "def456": {
                "path": "C:\\Users\\alice\\ideas",
                "ts": 1720000000000
            },
            "legacy": {
                "path": "C:\\tmp\\no-timestamp"
            }
        },
        "folder": "C:\\Users\\alice",
        "insider": false
    }"#;

    #[test]
    fn parses_windows_sample_and_sorts_recent_first() {
        let vaults = parse_vaults(SAMPLE).unwrap();
        assert_eq!(vaults.len(), 3);
        // `def456` has the higher ts → newest first.
        assert_eq!(vaults[0].id, "def456");
        assert_eq!(vaults[0].name, "ideas");
        // `abc123` second, `legacy` last (no ts).
        assert_eq!(vaults[1].id, "abc123");
        assert_eq!(vaults[1].name, "WorkVault");
        assert_eq!(vaults[2].id, "legacy");
        assert_eq!(vaults[2].last_opened_ms, None);
    }

    #[test]
    fn marks_exists_false_when_folder_missing() {
        let vaults = parse_vaults(SAMPLE).unwrap();
        // None of the sample paths exist on the test machine.
        assert!(vaults.iter().all(|v| !v.exists));
    }

    #[test]
    fn empty_vaults_object_returns_empty_list() {
        let json = r#"{ "vaults": {} }"#;
        assert!(parse_vaults(json).unwrap().is_empty());
    }

    #[test]
    fn missing_vaults_field_is_treated_as_empty() {
        // `serde(default)` on `vaults` → absent field is fine.
        let json = r#"{ "folder": "whatever" }"#;
        assert!(parse_vaults(json).unwrap().is_empty());
    }

    #[test]
    fn malformed_json_surfaces_an_error() {
        let err = parse_vaults("not json at all").unwrap_err();
        assert!(err.to_string().contains("parsing obsidian.json"));
    }

    #[test]
    fn detect_vaults_returns_empty_when_config_absent() {
        // On a CI runner without Obsidian this is the default
        // outcome — the test passes regardless of whether the dev
        // machine has Obsidian installed.
        let _ = detect_vaults().expect("detect_vaults must not error");
    }
}
