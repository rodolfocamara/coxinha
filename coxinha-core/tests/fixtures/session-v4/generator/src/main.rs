use anyhow::Result;
use coxinha_core::store::{Store,session::{NewSession,PersonalNoteRef}};
fn main() -> Result<()> {
    let root=std::env::args().nth(1).expect("disposable fixture destination");
    let s=Store::open(&root)?;
    let session=s.create_session(&NewSession::manual("Manual v4 title edited by human"))?;
    s.bind_session_note(&session.id,&PersonalNoteRef { id:uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000071")?,relative_path:"notes/retained-v4.md".into() })?;
    let id=s.list_meetings()?[0].0.clone();
    s.edit(&id,"human-fixture","Keep corrected words from v4")?;
    Ok(())
}
