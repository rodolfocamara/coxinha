use crate::store::Store;
use anyhow::{ensure, Result};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

pub fn validate_hash(hash: &str) -> Result<()> {
    ensure!(
        hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()),
        "expected SHA-256 hex digest"
    );
    Ok(())
}
pub(crate) fn raw_bytes(frames: u64) -> Result<u64> {
    frames
        .checked_mul(2)
        .and_then(|n| n.checked_add(44))
        .ok_or_else(|| anyhow::anyhow!("raw frame count overflow"))
}
#[cfg(test)]
thread_local! { pub(crate) static DIGEST_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
pub fn digest(path: &Path) -> Result<(String, u64)> {
    #[cfg(test)]
    DIGEST_CALLS.with(|count| count.set(count.get() + 1));
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0; 65536];
    let mut bytes = 0;
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        bytes += n as u64;
    }
    Ok((format!("{:x}", h.finalize()), bytes))
}
pub(crate) fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(target)?;
    for e in std::fs::read_dir(source)? {
        let e = e?;
        let ty = e.file_type()?;
        ensure!(!ty.is_symlink(), "symlinks are not library artifacts");
        if ty.is_dir() {
            copy_tree(&e.path(), &target.join(e.file_name()))?;
        } else {
            std::fs::copy(e.path(), target.join(e.file_name()))?;
        }
    }
    Ok(())
}

pub(crate) fn validate_destination(root: &Path, destination: &Path) -> Result<()> {
    ensure!(!destination.exists(), "destination must not exist");
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    ensure!(
        !parent.canonicalize()?.starts_with(root.canonicalize()?),
        "destination must be outside the library"
    );
    Ok(())
}

impl Store {
    pub fn publish_artifact(&self, meeting: &str, job: &str, bytes: &[u8]) -> Result<String> {
        let valid: i64 = self.db.query_row(
            "SELECT count(*) FROM job WHERE id=?1 AND meeting_id=?2 AND state='running'",
            params![job, meeting],
            |r| r.get(0),
        )?;
        ensure!(
            valid == 1,
            "artifact requires the running job in its meeting"
        );
        let id = uuid::Uuid::new_v4().to_string();
        let relative = format!("raw/{meeting}/outputs/{id}.json");
        let path = self.root.join(&relative);
        std::fs::create_dir_all(path.parent().unwrap())?;
        let mut f = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        let (hash, len) = digest(&path)?;
        self.db.execute("INSERT INTO artifact(id,meeting_id,job_id,relative_path,sha256,bytes) VALUES(?1,?2,?3,?4,?5,?6)",params![id,meeting,job,relative,hash,i64::try_from(len)?])?;
        Ok(id)
    }
    pub fn verify_raw(&self, meeting: &str) -> Result<()> {
        uuid::Uuid::parse_str(meeting)?;
        let directory = self.root.join("raw").join(meeting);
        let path = directory.join("manifest.json");
        if !path.exists() {
            if directory.exists() {
                for entry in std::fs::read_dir(&directory)? {
                    ensure!(
                        entry?.file_name() == "outputs",
                        "raw files exist without a recoverable manifest"
                    );
                }
            }
            return Ok(());
        }
        let manifest: crate::capture::CaptureManifest = serde_json::from_reader(File::open(path)?)?;
        ensure!(manifest.meeting == meeting, "manifest meeting mismatch");
        manifest.verified_tracks(&self.root)?;
        Ok(())
    }
    pub fn verify_artifacts(&self, meeting: &str) -> Result<()> {
        let mut q = self
            .db
            .prepare("SELECT relative_path,sha256,bytes FROM artifact WHERE meeting_id=?1")?;
        for row in q.query_map([meeting], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })? {
            let (path, hash, len) = row?;
            let (actual, bytes) = digest(&self.root.join(path))?;
            ensure!(
                hash == actual && u64::try_from(len)? == bytes,
                "artifact checksum mismatch"
            );
        }
        Ok(())
    }
    /// Export allowlist is the selected meeting's raw directory, never the library root.
    pub fn export_meeting(&self, meeting: &str, destination: &Path) -> Result<()> {
        let state: String = self.db.query_row(
            "SELECT capture_state FROM meeting WHERE id=?1",
            [meeting],
            |r| r.get(0),
        )?;
        ensure!(state != "recording", "cannot export an active capture");
        uuid::Uuid::parse_str(meeting)?;
        validate_destination(&self.root, destination)?;
        self.verify_artifacts(meeting)?;
        self.verify_raw(meeting)?;
        std::fs::create_dir_all(destination)?;
        let directory = self.root.join("raw").join(meeting);
        for name in [
            "manifest.json",
            "mic.wav",
            "output.wav",
            "imported.wav",
            "timing.jsonl",
        ] {
            let source = directory.join(name);
            if source.exists() {
                ensure!(
                    !source.symlink_metadata()?.file_type().is_symlink(),
                    "symlinks are not library artifacts"
                );
                std::fs::copy(source, destination.join(name))?;
            }
        }
        if let Ok(report) = self.processing_report(meeting) {
            std::fs::write(
                destination.join("transcript.json"),
                serde_json::to_vec_pretty(&report)?,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::JobInput;
    #[test]
    fn backup_restores_and_export_excludes_private_profiles() -> Result<()> {
        let d = tempfile::tempdir()?;
        let root = d.path().join("library");
        let s = Store::open(&root)?;
        let m = s.create_meeting("fixture")?;
        s.create_person("private person", &[], "user consent")?;
        let j = s.enqueue(
            &m,
            "stt",
            &JobInput {
                artifact_sha256: "a".repeat(64),
                config_sha256: "b".repeat(64),
                model_sha256: "c".repeat(64),
                engine_version: "v1".into(),
            },
        )?;
        assert!(s.claim(&j)?);
        s.publish_artifact(&m, &j, b"{}")?;
        s.finish_job(&j, None)?;
        std::fs::write(
            root.join("raw").join(&m).join("outputs/orphan.json"),
            b"unpublished",
        )?;
        let export = d.path().join("export");
        s.export_meeting(&m, &export)?;
        assert!(!export.join("profiles.db").exists());
        assert!(!export.join("private").exists());
        assert!(!export.join("outputs").exists());
        let backup = d.path().join("backup");
        s.backup(&backup)?;
        let restored = Store::open(&backup)?;
        restored.verify_artifacts(&m)?;
        assert_eq!(restored.list_meetings()?.len(), 1);
        Ok(())
    }
}
