//! Spec 0124 P5: the owner's mark on a past meeting, one per session. Only the
//! owner sets it; nothing derives it.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const FILE: &str = "meeting-marks.json";
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Mark {
    Useful,
    NotUseful,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Marks {
    #[serde(default)]
    pub marks: BTreeMap<String, Mark>,
}

fn path(data: &Path) -> PathBuf {
    data.join(FILE)
}

pub fn load(data: &Path) -> Marks {
    crate::settings_file::load(&path(data))
}

/// `None` clears the mark, so it can always be taken back.
pub fn set(data: &Path, session: &str, mark: Option<Mark>) -> Result<(), String> {
    crate::items::folder::valid_id(session)?;
    let _guard = LOCK.lock().map_err(|_| "marks lock poisoned")?;
    let mut marks = load(data);
    match mark {
        Some(mark) => marks.marks.insert(session.to_owned(), mark),
        None => marks.marks.remove(session),
    };
    crate::settings_file::save(&path(data), &marks)
}

/// Spec 0115 P3 retires a session into the one prepared for its event; the
/// owner's verdict goes with the recording. One already on the kept session wins.
pub fn follow(data: &Path, retired: &str, kept: &str) {
    let Ok(_guard) = LOCK.lock() else { return };
    let mut marks = load(data);
    let Some(mark) = marks.marks.remove(retired) else {
        return;
    };
    marks.marks.entry(kept.to_owned()).or_insert(mark);
    if let Err(error) = crate::settings_file::save(&path(data), &marks) {
        tracing::warn!("meeting mark did not follow its session: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mark_is_per_session_and_can_be_taken_back() {
        let dir = tempfile::tempdir().unwrap();
        set(dir.path(), "s-1", Some(Mark::Useful)).unwrap();
        set(dir.path(), "s-2", Some(Mark::NotUseful)).unwrap();
        assert_eq!(load(dir.path()).marks["s-1"], Mark::Useful);
        set(dir.path(), "s-1", Some(Mark::NotUseful)).unwrap();
        assert_eq!(load(dir.path()).marks["s-1"], Mark::NotUseful);
        set(dir.path(), "s-1", None).unwrap();
        let marks = load(dir.path()).marks;
        assert!(!marks.contains_key("s-1"));
        assert_eq!(marks["s-2"], Mark::NotUseful);
    }

    #[test]
    fn a_bad_session_id_is_refused_and_a_broken_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(set(dir.path(), "../evil", Some(Mark::Useful)).is_err());
        std::fs::write(dir.path().join(FILE), "not json").unwrap();
        assert!(load(dir.path()).marks.is_empty());
    }

    #[test]
    fn a_mark_follows_a_retired_session_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        set(dir.path(), "old", Some(Mark::Useful)).unwrap();
        follow(dir.path(), "old", "kept");
        let marks = load(dir.path()).marks;
        assert_eq!(marks["kept"], Mark::Useful);
        assert!(!marks.contains_key("old"));
        set(dir.path(), "old", Some(Mark::NotUseful)).unwrap();
        follow(dir.path(), "old", "kept");
        assert_eq!(load(dir.path()).marks["kept"], Mark::Useful);
        follow(dir.path(), "nothing", "kept");
        assert_eq!(load(dir.path()).marks["kept"], Mark::Useful);
    }
}
