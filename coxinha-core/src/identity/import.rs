use crate::store::Store;
use anyhow::{ensure, Result};
use rusqlite::params;
use serde::Serialize;
use std::collections::HashSet;

const MAX_IMPORT: usize = 500;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PeopleImport {
    pub created: usize,
    pub skipped: usize,
}

/// Case, Latin accents and spacing ignored, like `nameKey` in the frontend.
pub fn name_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

impl Store {
    /// Creates the people no one is named after yet, in one transaction (spec 0110 P4).
    pub fn import_people(&self, names: &[String], consent_origin: &str) -> Result<PeopleImport> {
        ensure!(
            names.len() <= MAX_IMPORT,
            "at most {MAX_IMPORT} people per import"
        );
        ensure!(!consent_origin.trim().is_empty(), "consent origin required");
        let tx = self.profiles.unchecked_transaction()?;
        let mut taken: HashSet<String> = {
            let mut rows = tx.prepare("SELECT name FROM person")?;
            let names = rows.query_map([], |r| r.get::<_, String>(0))?;
            names
                .collect::<rusqlite::Result<Vec<_>>>()?
                .iter()
                .map(|n| name_key(n))
                .collect()
        };
        let mut created = 0;
        for name in names {
            let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
            ensure!(
                name.len() <= 500 && !name.chars().any(char::is_control),
                "invalid person name"
            );
            if name.is_empty() || !taken.insert(name_key(&name)) {
                continue;
            }
            tx.execute(
                "INSERT INTO person VALUES(?1,?2,'[]',?3)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    name,
                    consent_origin.trim()
                ],
            )?;
            created += 1;
        }
        tx.commit()?;
        Ok(PeopleImport {
            created,
            skipped: names.len() - created,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_fold_case_accents_and_spacing() {
        assert_eq!(name_key("  José   da SILVA "), "jose da silva");
    }

    #[test]
    fn import_skips_existing_and_repeated_names() -> Result<()> {
        let d = tempfile::tempdir()?;
        let s = Store::open(d.path())?;
        s.create_person("Ana Souza", &[], "test operator")?;
        let names = ["ana  souza", "Bruno Lima", "BRUNO LIMA", "  ", "Célia"].map(String::from);
        let result = s.import_people(&names, "calendar")?;
        assert_eq!(
            result,
            PeopleImport {
                created: 2,
                skipped: 3
            }
        );
        let mut rows = s
            .profiles
            .prepare("SELECT name, consent_origin FROM person ORDER BY name")?;
        let people: Vec<(String, String)> = rows
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        assert_eq!(
            people,
            [
                ("Ana Souza".into(), "test operator".into()),
                ("Bruno Lima".into(), "calendar".into()),
                ("Célia".into(), "calendar".into()),
            ]
        );
        Ok(())
    }

    #[test]
    fn a_bad_name_imports_nobody() -> Result<()> {
        let d = tempfile::tempdir()?;
        let s = Store::open(d.path())?;
        let names = ["Bruno".to_string(), "bad\u{7}name".to_string()];
        assert!(s.import_people(&names, "calendar").is_err());
        assert!(s.import_people(&[], " ").is_err());
        let count: i64 = s
            .profiles
            .query_row("SELECT count(*) FROM person", [], |r| r.get(0))?;
        assert_eq!(count, 0);
        Ok(())
    }
}
