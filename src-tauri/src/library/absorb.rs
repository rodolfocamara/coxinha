//! Spec 0115 P3: a recording confirmed for a calendar event joins the session
//! already prepared for that event, so the agenda shows the meeting once.
use super::*;
use crate::auto_record::plan;
use crate::calendar::Event;
use crate::items::folder::{self, ItemKind, ItemRef};
use crate::storage::Storage;
use sessions::SessionAction;
use std::path::Path;
use std::sync::Arc;

/// Text after the frontmatter with a letter or digit belongs to the owner.
pub(super) fn blank_note(raw: &str) -> bool {
    let body = raw
        .strip_prefix("---")
        .and_then(|rest| rest.split_once("\n---"))
        .map_or(raw, |(_, body)| body);
    !body.chars().any(char::is_alphanumeric)
}

/// Markdown files under the vault, without dot folders (trash, index).
fn mentions(dir: &Path, id: &str, own: Option<&Path>, depth: usize) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        let hidden = entry.file_name().to_string_lossy().starts_with('.');
        match entry.file_type() {
            Ok(t) if t.is_dir() && !hidden && depth < 8 => mentions(&path, id, own, depth + 1),
            Ok(t) if t.is_file() && path.extension().is_some_and(|e| e == "md") => {
                Some(path.as_path()) != own
                    && std::fs::read_to_string(&path).is_ok_and(|text| text.contains(id))
            }
            _ => false,
        }
    })
}

/// Nothing of the owner hangs on the session: an empty note, no item folder
/// and no other note naming it.
fn disposable(vault: &Path, session: &Value) -> bool {
    let Some(id) = session["id"].as_str() else {
        return false;
    };
    let note = session["note_path"].as_str().map(|p| vault.join(p));
    let blank = note
        .as_ref()
        .is_none_or(|path| std::fs::read_to_string(path).is_ok_and(|raw| blank_note(&raw)));
    let item = ItemRef {
        kind: ItemKind::Meeting,
        id: id.to_owned(),
        title: String::new(),
        date: None,
    };
    blank
        && matches!(folder::locate(vault, &item), Ok(None))
        && !mentions(vault, id, note.as_deref(), 0)
}

/// Moves the recording of `session_id` into the session prepared for
/// `event` and retires `session_id`, when it holds nothing of the owner.
/// Returns the session that now owns the recording.
pub(super) async fn into_prepared(
    library: &Library,
    storage: &Arc<Storage>,
    session_id: &str,
    event: &Event,
) -> Result<Option<String>, String> {
    let sessions = library.session_list().await?;
    let Some(keep) = plan::reusable_session(&sessions, event) else {
        return Ok(None);
    };
    let retired = sessions
        .as_array()
        .and_then(|list| list.iter().find(|s| s["id"].as_str() == Some(session_id)));
    let Some(retired) = retired else {
        return Ok(None);
    };
    if keep == session_id || retired["meeting_id"].is_null() {
        return Ok(None);
    }
    let vault = storage.vault().to_path_buf();
    let check = retired.clone();
    let free = tauri::async_runtime::spawn_blocking(move || disposable(&vault, &check))
        .await
        .map_err(|e| e.to_string())?;
    if !free {
        return Ok(None);
    }
    let note = sessions::mutate(
        library.clone(),
        storage.clone(),
        Action::Session(SessionAction::Absorb(keep.clone(), session_id.to_owned())),
    )
    .await?;
    if let Some(note) = note.as_str().and_then(|n| uuid::Uuid::parse_str(n).ok()) {
        // The empty note goes to the trash; a failure leaves a harmless file.
        if let Err(error) = library.delete_note(storage.clone(), note).await {
            tracing::warn!("absorbed session note stayed in place: {error}");
        }
    }
    Ok(Some(keep))
}

/// Recordings confirmed before spec 0115 still sit next to the prepared
/// session of their event; each one is joined once its event is in view.
pub(super) async fn sweep(library: &Library, storage: &Arc<Storage>, events: &[Event]) {
    let Ok(sessions) = library.session_list().await else {
        return;
    };
    let Some(list) = sessions.as_array() else {
        return;
    };
    let mut pairs = Vec::new();
    for event in events.iter().filter(|e| !e.cancelled && !e.all_day) {
        if plan::reusable_session(&sessions, event).is_none() {
            continue;
        }
        let title = event.title.trim().to_lowercase();
        let near = |s: &Value| {
            let (Some(a), Some(b)) = (s["starts_at"].as_str(), Some(event.starts_at.as_str()))
            else {
                return false;
            };
            let parse = |v: &str| chrono::DateTime::parse_from_rfc3339(v).ok();
            matches!((parse(a), parse(b)), (Some(a), Some(b)) if (a - b).num_minutes().abs() <= 30)
        };
        for s in list {
            let recorded = !s["meeting_id"].is_null();
            let same = s["title"].as_str().map(|t| t.trim().to_lowercase()) == Some(title.clone());
            if recorded && same && near(s) {
                if let Some(id) = s["id"].as_str() {
                    pairs.push((id.to_owned(), event.clone()));
                }
            }
        }
    }
    for (id, event) in pairs {
        if let Err(error) = into_prepared(library, storage, &id, &event).await {
            tracing::warn!("duplicate session not joined: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_frontmatter_and_punctuation_is_blank() {
        let head = "---\ncoxinha-note: 1\nid: \"a1\"\n---\n";
        assert!(blank_note(head));
        assert!(blank_note(&format!("{head}*\n\n- ")));
        assert!(!blank_note(&format!("{head}Pauta: roadmap")));
        assert!(!blank_note("just text"));
    }

    #[test]
    fn a_session_with_an_item_folder_or_mentioned_elsewhere_is_kept() {
        let vault = tempfile::tempdir().unwrap();
        let notes = vault.path().join("notes");
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::write(notes.join("own.md"), "---\nid: x\n---\n").unwrap();
        let session = json!({ "id": "s-1", "note_path": "notes/own.md" });
        assert!(disposable(vault.path(), &session));
        std::fs::write(notes.join("own.md"), "---\nid: x\n---\nAgenda").unwrap();
        assert!(!disposable(vault.path(), &session));
        std::fs::write(notes.join("own.md"), "---\nid: x\n---\n").unwrap();
        std::fs::write(notes.join("task.md"), "meeting: s-1").unwrap();
        assert!(!disposable(vault.path(), &session));
        std::fs::remove_file(notes.join("task.md")).unwrap();
        let item = vault.path().join("meetings/2026-11-03 Roadmap");
        std::fs::create_dir_all(&item).unwrap();
        std::fs::write(
            item.join(folder::MARKER),
            r#"{"version":1,"kind":"meeting","id":"s-1","references":[]}"#,
        )
        .unwrap();
        assert!(!disposable(vault.path(), &session));
    }
}
