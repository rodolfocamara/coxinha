use super::{PreparedProcessing, ProcessingResult};
use crate::store::Store;
use anyhow::{ensure, Context, Result};
use rusqlite::{params, OptionalExtension};
use std::{fs::OpenOptions, io::Write, path::Path};

impl Store {
    /// A retry resumes the original IDs/vector candidates, never a new decode.
    /// The caller claims a failed/pending job before resuming an incomplete commit.
    pub fn resume_processing_publication(&mut self, input: &PreparedProcessing) -> Result<bool> {
        let pending: Option<(String, String, String)> = self.profiles.query_row(
            "SELECT meeting_id,input_json,result_json FROM processing_publication WHERE job_id=?1",
            [&input.job], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        let Some((meeting, prepared, result)) = pending else {
            return Ok(false);
        };
        ensure!(
            meeting == input.meeting && same_input(&prepared, input)?,
            "pending publication input differs; retain original delivery"
        );
        let mut result: ProcessingResult =
            serde_json::from_str(&result).context("invalid private publication intent")?;
        if self.job_state(&input.job)? == "succeeded" {
            super::validate_processing_source(input)?;
            for turn in &mut result.turns {
                turn.embedding = None;
                turn.space = None;
            }
            let saved: String = self.db.query_row(
                "SELECT result_json FROM processing_run WHERE job_id=?1",
                [&input.job],
                |r| r.get(0),
            )?;
            ensure!(
                saved == serde_json::to_string(&result)?,
                "completed publication differs from pending delivery"
            );
            self.verify_processing_artifact(input, &public_bytes(input, &result)?)?;
            self.profiles.execute(
                "DELETE FROM processing_publication WHERE job_id=?1",
                [&input.job],
            )?;
        } else {
            self.commit_processing(input, result)?;
        }
        Ok(true)
    }

    pub(super) fn check_pending_delivery(
        &self,
        input: &PreparedProcessing,
        result: &str,
    ) -> Result<()> {
        let existing: Option<(String, String)> = self
            .profiles
            .query_row(
                "SELECT input_json,result_json FROM processing_publication WHERE job_id=?1",
                [&input.job],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((prepared, saved)) = existing {
            ensure!(
                same_input(&prepared, input)? && saved == result,
                "publication pending; resume the original delivery before another inference"
            );
        }
        Ok(())
    }

    pub(super) fn publish_processing_artifact(
        &self,
        input: &PreparedProcessing,
        bytes: &[u8],
    ) -> Result<()> {
        uuid::Uuid::parse_str(&input.meeting)?;
        uuid::Uuid::parse_str(&input.job)?;
        let running: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM job WHERE id=?1 AND meeting_id=?2 AND state='running')",
            params![input.job, input.meeting],
            |r| r.get(0),
        )?;
        ensure!(
            running,
            "publication requires the running job in its meeting"
        );
        let root = self.root.canonicalize()?;
        let meeting = root.join("raw").join(&input.meeting);
        ensure!(
            meeting.canonicalize()? == meeting,
            "publication directory escapes library"
        );
        let directory = meeting.join("outputs");
        match std::fs::create_dir(&directory) {
            Ok(()) => sync_directory(&meeting)?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        ensure!(
            directory.symlink_metadata()?.is_dir() && directory.canonicalize()? == directory,
            "invalid publication directory"
        );
        let path = directory.join(format!("{}.json", input.job));
        match path.symlink_metadata() {
            Ok(_) => verify_file(&path, bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let temporary =
                    directory.join(format!(".{}.{}.tmp", input.job, uuid::Uuid::new_v4()));
                let install: Result<()> = (|| {
                    let mut file = OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&temporary)?;
                    file.write_all(bytes)?;
                    file.sync_all()?;
                    // Same-directory hard link installs the completed derived file
                    // atomically without replacing any existing destination.
                    match std::fs::hard_link(&temporary, &path) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                            verify_file(&path, bytes)?
                        }
                        Err(error) => return Err(error.into()),
                    }
                    sync_directory(&directory)?;
                    Ok(())
                })();
                let _ = std::fs::remove_file(&temporary);
                install?;
            }
            Err(error) => return Err(error.into()),
        }
        checkpoint("file")?;
        let (hash, len) = crate::artifacts::digest(&path)?;
        self.db.execute("INSERT INTO artifact(id,meeting_id,job_id,relative_path,sha256,bytes) VALUES(?1,?2,?1,?3,?4,?5) ON CONFLICT(id) DO NOTHING", params![input.job, input.meeting, relative_path(input), hash, i64::try_from(len)?])?;
        self.verify_processing_artifact(input, bytes)?;
        checkpoint("artifact")?;
        Ok(())
    }

    fn verify_processing_artifact(&self, input: &PreparedProcessing, bytes: &[u8]) -> Result<()> {
        use sha2::{Digest, Sha256};
        let expected = format!("{:x}", Sha256::digest(bytes));
        let matched: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM artifact WHERE id=?1 AND meeting_id=?2 AND job_id=?1 AND relative_path=?3 AND sha256=?4 AND bytes=?5)", params![input.job, input.meeting, relative_path(input), expected, i64::try_from(bytes.len())?], |r| r.get(0))?;
        ensure!(matched, "conflicting publication artifact row");
        verify_file(&self.root.canonicalize()?.join(relative_path(input)), bytes)
    }
}

fn same_input(saved: &str, current: &PreparedProcessing) -> Result<bool> {
    let mut saved: PreparedProcessing = serde_json::from_str(saved)?;
    let mut current = current.clone();
    // A restored library has different absolute raw paths. The original hashes,
    // track identities, frames, config and job remain binding; commit validates
    // the newly prepared descriptors against the current library's manifest.
    for track in saved.tracks.iter_mut().chain(current.tracks.iter_mut()) {
        track.path.clear();
    }
    Ok(serde_json::to_string(&saved)? == serde_json::to_string(&current)?)
}

pub(super) fn public_bytes(
    input: &PreparedProcessing,
    result: &ProcessingResult,
) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(
        &serde_json::json!({"job":input.job,"result":result}),
    )?)
}
fn relative_path(input: &PreparedProcessing) -> String {
    format!("raw/{}/outputs/{}.json", input.meeting, input.job)
}
fn verify_file(path: &Path, bytes: &[u8]) -> Result<()> {
    use sha2::{Digest, Sha256};
    ensure!(
        path.canonicalize()? == path,
        "publication path escapes its owned location"
    );
    ensure!(
        path.symlink_metadata()?.is_file(),
        "publication is not a regular owned file"
    );
    let (hash, len) = crate::artifacts::digest(path)?;
    ensure!(
        len == bytes.len() as u64 && hash == format!("{:x}", Sha256::digest(bytes)),
        "conflicting publication file; preserved"
    );
    Ok(())
}
fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    std::fs::File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
thread_local! { pub(super) static FAIL_AT: std::cell::Cell<&'static str> = const { std::cell::Cell::new("") }; }
pub(super) fn checkpoint(stage: &str) -> Result<()> {
    #[cfg(test)]
    FAIL_AT.with(|point| {
        if point.get() == stage {
            point.set("");
            anyhow::bail!("synthetic interruption after {stage}");
        }
        Ok::<_, anyhow::Error>(())
    })?;
    let _ = stage;
    Ok(())
}
