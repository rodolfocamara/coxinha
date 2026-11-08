use crate::store::Store;
use anyhow::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrphanReport {
    pub meeting: String,
    /// `None` when raw recovery succeeded; otherwise raw files were left for explicit recovery.
    pub error: Option<String>,
}

impl Store {
    /// No capture outlives the process, so at open every `recording` row is orphaned.
    /// A failed raw recovery still releases the row; manifest and audio stay untouched.
    pub fn reconcile_orphan_captures(&self) -> Result<Vec<OrphanReport>> {
        let ids = self
            .db
            .prepare("SELECT id FROM meeting WHERE capture_state='recording' ORDER BY rowid")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|meeting| {
                let error = self.recover_capture(&meeting).err().map(|e| format!("{e:#}"));
                if error.is_some() {
                    self.db.execute(
                        "UPDATE meeting SET capture_state='interrupted' WHERE id=?1 AND capture_state='recording'",
                        [&meeting],
                    )?;
                }
                Ok(OrphanReport { meeting, error })
            })
            .collect()
    }
}

#[cfg(test)]
#[path = "reconcile_tests.rs"]
mod tests;
