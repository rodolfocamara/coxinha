//! Durable root-backend publication intent. Filesystem ownership is verified by Storage.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PersonalNoteIntent {
    pub session_id: String,
    pub note_id: Uuid,
    pub relative_path: String,
    pub token: String,
    pub initial_body: String,
    pub state: String,
    pub last_error: Option<String>,
}

impl Store {
    /// Canonical guard for generic note deletion, including legacy bindings and
    /// unpublished reservations. Never infer protection from editable Markdown.
    pub fn personal_note_is_protected(&self, id: Uuid, path: Option<&str>) -> Result<bool> {
        Ok(self.db.query_row(
            "SELECT EXISTS (
                SELECT 1 FROM session WHERE note_id=?1 OR (?2 IS NOT NULL AND note_path=?2)
                UNION ALL
                SELECT 1 FROM personal_note_intent WHERE note_id=?1 OR (?2 IS NOT NULL AND relative_path=?2)
            )",
            params![id.to_string(), path],
            |row| row.get(0),
        )?)
    }

    pub fn personal_note_intent(&self, session: &str) -> Result<Option<PersonalNoteIntent>> {
        Ok(self.db.query_row(
            "SELECT session_id,note_id,relative_path,token,initial_body,state,last_error FROM personal_note_intent WHERE session_id=?1", [session],
            |r| Ok(PersonalNoteIntent { session_id:r.get(0)?, note_id: Uuid::parse_str(&r.get::<_,String>(1)?).map_err(|_|rusqlite::Error::InvalidQuery)?, relative_path:r.get(2)?, token:r.get(3)?, initial_body:r.get(4)?, state:r.get(5)?, last_error:r.get(6)? })
        ).optional()?)
    }

    /// Reservation commits before the caller is allowed to publish any Markdown.
    pub fn reserve_personal_note(&self, session: &str) -> Result<PersonalNoteIntent> {
        let tx = self.db.unchecked_transaction()?;
        let owner = self.session(session)?.context("session not found")?;
        if let Some(intent) = self.personal_note_intent(session)? {
            tx.commit()?;
            return Ok(intent);
        }
        ensure!(
            owner.personal_note.is_none(),
            "session note has no publication intent; explicit recovery required"
        );
        let note = Uuid::new_v4();
        let path = format!("notes/session-{note}.md");
        // Session titles are user-controlled: do not splice them into an envelope.
        tx.execute("INSERT INTO personal_note_intent(session_id,note_id,relative_path,token,initial_body) VALUES(?1,?2,?3,?4,?5)",
            params![session,note.to_string(),path,Uuid::new_v4().to_string(),""])?;
        tx.commit()?;
        self.personal_note_intent(session)?
            .context("reserved intent missing")
    }

    /// Only root calls this after verifying UUID, intent metadata, current file and index.
    /// A move may change the path, never the UUID or session ownership.
    pub fn complete_personal_note(&self, session: &str, note: &PersonalNoteRef) -> Result<()> {
        note.validate()?;
        let tx = self.db.unchecked_transaction()?;
        let intent = self
            .personal_note_intent(session)?
            .context("personal note intent missing")?;
        ensure!(
            intent.note_id == note.id,
            "personal note intent UUID conflict"
        );
        ensure!(tx.execute("UPDATE session SET note_id=?2,note_path=?3 WHERE id=?1 AND (note_id IS NULL OR note_id=?2)",
            params![session,note.id.to_string(),note.relative_path])? == 1, "session note ownership conflict");
        tx.execute(
            "UPDATE personal_note_intent SET state='complete',last_error=NULL WHERE session_id=?1",
            [session],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn personal_note_error(&self, session: &str, error: &str) -> Result<()> {
        self.db.execute(
            "UPDATE personal_note_intent SET last_error=?2 WHERE session_id=?1",
            params![session, error],
        )?;
        Ok(())
    }

    pub fn pending_personal_notes(&self) -> Result<Vec<String>> {
        let mut q = self.db.prepare(
            "SELECT session_id FROM personal_note_intent WHERE state='reserved' ORDER BY rowid",
        )?;
        let rows = q
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reservation_blocks_other_bindings_and_cannot_change_identity() -> Result<()> {
        let d = tempfile::tempdir()?;
        let s = Store::open(d.path())?;
        let a = s.create_session(&NewSession::manual("Owner"))?;
        let b = s.create_session(&NewSession::manual("Other"))?;
        let i = s.reserve_personal_note(&a.id)?;
        let reserved = PersonalNoteRef {
            id: i.note_id,
            relative_path: i.relative_path.clone(),
        };
        assert!(s.bind_session_note(&b.id, &reserved).is_err());
        assert!(s
            .bind_session_note(
                &a.id,
                &PersonalNoteRef {
                    id: Uuid::new_v4(),
                    relative_path: "notes/foreign.md".into()
                }
            )
            .is_err());
        assert!(s
            .db
            .execute(
                "UPDATE personal_note_intent SET token='changed' WHERE session_id=?1",
                [&a.id]
            )
            .is_err());
        assert!(s
            .db
            .execute(
                "UPDATE personal_note_intent SET state='complete' WHERE session_id=?1",
                [&a.id]
            )
            .is_err());
        s.complete_personal_note(&a.id, &reserved)?;
        assert!(s
            .db
            .execute(
                "UPDATE personal_note_intent SET state='reserved' WHERE session_id=?1",
                [&a.id]
            )
            .is_err());
        assert_eq!(s.personal_note_intent(&a.id)?.unwrap().token, i.token);
        assert!(s.session(&b.id)?.unwrap().personal_note.is_none());
        Ok(())
    }

    #[test]
    fn reserve_reopen_complete_move_and_unknown_are_safe() -> Result<()> {
        let d = tempfile::tempdir()?;
        let s = Store::open(d.path())?;
        let session = s.create_session(&NewSession::manual("No audio"))?;
        assert!(s.reserve_personal_note("unknown").is_err());
        let intent = s.reserve_personal_note(&session.id)?;
        assert!(s.list_meetings()?.is_empty());
        assert_eq!(
            s.reserve_personal_note(&session.id)?.note_id,
            intent.note_id
        );
        drop(s);
        let s = Store::open(d.path())?;
        assert_eq!(s.pending_personal_notes()?, vec![session.id.clone()]);
        let mut note = PersonalNoteRef {
            id: intent.note_id,
            relative_path: intent.relative_path,
        };
        s.complete_personal_note(&session.id, &note)?;
        s.complete_personal_note(&session.id, &note)?;
        note.relative_path = "notes/moved.md".into();
        s.complete_personal_note(&session.id, &note)?;
        note.id = Uuid::new_v4();
        assert!(s.complete_personal_note(&session.id, &note).is_err());
        assert!(s.pending_personal_notes()?.is_empty());
        assert_eq!(
            s.session(&session.id)?.unwrap().personal_note.unwrap().id,
            intent.note_id
        );
        Ok(())
    }
}
