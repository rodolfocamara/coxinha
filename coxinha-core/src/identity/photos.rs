//! Directory photos of invitees (spec 0117 P1). Third-party data: off by
//! default, only under `private/`, and gone with the person or the opt-out.
use super::import::name_key;
use crate::store::Store;
use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

pub(crate) const SCHEMA: &str = "
CREATE TABLE directory_photo_state(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), blocked TEXT, retry_at INTEGER);
INSERT INTO directory_photo_state VALUES(1,0,NULL,NULL);
CREATE TABLE person_photo(person_id TEXT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE, checked_at INTEGER NOT NULL, media_type TEXT CHECK(media_type IN('image/jpeg','image/png')));
";

const WEEK_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const MAX_PHOTO_BYTES: usize = 5 * 1024 * 1024;

/// `consent_origin` is the UI text at import time (specs 0102, 0110). A test
/// holds this list to the locale files, so a reworded text cannot drop people.
const INVITEE_ORIGINS: [&str; 4] = [
    "Invited to this meeting in the calendar",
    "Convidado(a) desta reunião na agenda",
    "Participant in meetings from your calendar",
    "Participante de reuniões da sua agenda",
];

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoStatus {
    pub enabled: bool,
    /// An i18n code that stays until the owner acts; nothing retries it.
    pub blocked: Option<String>,
    pub stored: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhotoInvitee {
    pub name: String,
    pub mail: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DuePhoto {
    pub person_id: String,
    pub mail: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoEntry {
    pub person_id: String,
    pub name: String,
}

fn media_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() > MAX_PHOTO_BYTES {
        None
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else {
        None
    }
}

impl Store {
    fn photos_dir(&self) -> PathBuf {
        self.root.join("private/photos")
    }

    pub fn photo_status(&self) -> Result<PhotoStatus> {
        let (enabled, blocked) = self.profiles.query_row(
            "SELECT enabled,blocked FROM directory_photo_state WHERE id=1",
            [],
            |r| Ok((r.get::<_, i64>(0)? == 1, r.get(1)?)),
        )?;
        let stored: i64 = self.profiles.query_row(
            "SELECT count(*) FROM person_photo WHERE media_type IS NOT NULL",
            [],
            |r| r.get(0),
        )?;
        Ok(PhotoStatus {
            enabled,
            blocked,
            stored: stored as usize,
        })
    }

    /// The owner's opt-in, recorded only once the scope was really granted.
    pub fn photo_enable(&self) -> Result<()> {
        self.profiles.execute(
            "UPDATE directory_photo_state SET enabled=1,blocked=NULL,retry_at=NULL WHERE id=1",
            [],
        )?;
        Ok(())
    }

    /// Committed before the files go: a crash in between leaves files the
    /// next sweep removes, never an opt-in the owner already turned off.
    pub fn photo_disable(&self) -> Result<()> {
        let tx = self.profiles.unchecked_transaction()?;
        tx.execute(
            "UPDATE directory_photo_state SET enabled=0,blocked=NULL,retry_at=NULL WHERE id=1",
            [],
        )?;
        tx.execute("DELETE FROM person_photo", [])?;
        tx.commit()?;
        self.photo_sweep()
    }

    pub fn photo_block(&self, code: &str) -> Result<()> {
        self.profiles.execute(
            "UPDATE directory_photo_state SET blocked=?1 WHERE id=1",
            [code],
        )?;
        Ok(())
    }

    pub fn photo_pause(&self, until: i64) -> Result<()> {
        self.profiles.execute(
            "UPDATE directory_photo_state SET retry_at=?1 WHERE id=1",
            [until],
        )?;
        Ok(())
    }

    /// Drops every file without a row: a person who left, or an interrupted opt-out.
    pub fn photo_sweep(&self) -> Result<()> {
        let dir = self.photos_dir();
        if !self.photo_status()?.enabled {
            return match std::fs::remove_dir_all(&dir) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
                _ => Ok(()),
            };
        }
        let mut rows = self
            .profiles
            .prepare("SELECT person_id FROM person_photo WHERE media_type IS NOT NULL")?;
        let kept = rows
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<HashSet<_>>>()?;
        let entries = match std::fs::read_dir(&dir) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            entries => entries?,
        };
        for entry in entries {
            let entry = entry?;
            if !kept.contains(&*entry.file_name().to_string_lossy()) {
                std::fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }

    /// People imported from invitees whose weekly check is due. A name with
    /// two mails is skipped: no photo is better than someone else's face.
    pub fn photo_due(
        &self,
        invitees: &[PhotoInvitee],
        now: i64,
        limit: usize,
    ) -> Result<Vec<DuePhoto>> {
        self.photo_sweep()?;
        let (enabled, blocked, retry_at) = self.profiles.query_row(
            "SELECT enabled,blocked,retry_at FROM directory_photo_state WHERE id=1",
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)? == 1,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                ))
            },
        )?;
        if !enabled || blocked.is_some() || retry_at.is_some_and(|at| at > now) {
            return Ok(Vec::new());
        }
        let mut mails: HashMap<String, Option<String>> = HashMap::new();
        for invitee in invitees {
            let mail = invitee.mail.trim().to_lowercase();
            mails
                .entry(name_key(&invitee.name))
                .and_modify(|known| {
                    if known.as_deref() != Some(&mail) {
                        *known = None;
                    }
                })
                .or_insert(Some(mail));
        }
        let origins = INVITEE_ORIGINS.map(|_| "?").join(",");
        let mut rows = self.profiles.prepare(&format!(
            "SELECT p.id,p.name,pp.checked_at FROM person p LEFT JOIN person_photo pp ON pp.person_id=p.id WHERE p.consent_origin IN ({origins}) ORDER BY coalesce(pp.checked_at,0),p.id"
        ))?;
        let people = rows.query_map(rusqlite::params_from_iter(INVITEE_ORIGINS), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })?;
        let mut due = Vec::new();
        for person in people {
            let (person_id, name, checked_at) = person?;
            if checked_at.is_some_and(|at| now - at < WEEK_SECONDS) {
                continue;
            }
            if let Some(Some(mail)) = mails.get(&name_key(&name)) {
                due.push(DuePhoto {
                    person_id,
                    mail: mail.clone(),
                });
                if due.len() == limit {
                    break;
                }
            }
        }
        Ok(due)
    }

    /// `None`, or anything that is not a JPEG or PNG, means no photo for this
    /// week. False when the opt-out or the person's removal won the race with
    /// the download, and nothing is written.
    pub fn photo_record(&self, person: &str, now: i64, photo: Option<&[u8]>) -> Result<bool> {
        let exists = self
            .profiles
            .query_row("SELECT 1 FROM person WHERE id=?1", [person], |_| Ok(()))
            .optional()?
            .is_some();
        if !exists || !self.photo_status()?.enabled {
            return Ok(false);
        }
        let file = self
            .photos_dir()
            .join(uuid::Uuid::parse_str(person)?.to_string());
        let found = photo.and_then(|bytes| media_type(bytes).map(|media| (bytes, media)));
        if let Some((bytes, _)) = found {
            let dir = self.photos_dir();
            std::fs::create_dir_all(&dir)?;
            let partial = dir.join(format!("{person}.partial"));
            std::fs::write(&partial, bytes)?;
            std::fs::rename(&partial, &file)?;
        } else {
            match std::fs::remove_file(&file) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                _ => (),
            }
        }
        self.profiles.execute(
            "INSERT INTO person_photo VALUES(?1,?2,?3) ON CONFLICT(person_id) DO UPDATE SET checked_at=excluded.checked_at,media_type=excluded.media_type",
            params![person, now, found.map(|(_, media)| media)],
        )?;
        Ok(true)
    }

    pub fn photo_index(&self) -> Result<Vec<PhotoEntry>> {
        let mut rows = self.profiles.prepare(
            "SELECT p.id,p.name FROM person_photo pp JOIN person p ON p.id=pp.person_id WHERE pp.media_type IS NOT NULL ORDER BY p.name,p.id",
        )?;
        let entries = rows.query_map([], |r| {
            Ok(PhotoEntry {
                person_id: r.get(0)?,
                name: r.get(1)?,
            })
        })?;
        Ok(entries.collect::<rusqlite::Result<_>>()?)
    }

    /// The media type and bytes, by person id only: the UI never sees a path.
    pub fn photo_read(&self, person: &str) -> Result<Option<(String, Vec<u8>)>> {
        let media: Option<String> = self
            .profiles
            .query_row(
                "SELECT media_type FROM person_photo WHERE person_id=?1 AND media_type IS NOT NULL",
                [person],
                |r| r.get(0),
            )
            .optional()?;
        let Some(media) = media else {
            return Ok(None);
        };
        let file = self
            .photos_dir()
            .join(uuid::Uuid::parse_str(person)?.to_string());
        match std::fs::read(file) {
            Ok(bytes) => Ok(Some((media, bytes))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
#[path = "photos_tests.rs"]
mod tests;
