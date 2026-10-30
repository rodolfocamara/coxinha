use super::*;
use sha2::{Digest, Sha256};

#[derive(Clone, Copy)]
enum Workflow {
    Ordinary,
    DailyArchive,
    BackupRestore,
}

struct Case {
    dir: tempfile::TempDir,
    storage: Storage,
    id: Uuid,
    old: &'static str,
    moved: &'static str,
    saved: Vec<u8>,
    replacement: &'static str,
}

async fn fixture() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["notes", "daily"] {
        fs::create_dir(dir.path().join(sub)).await.unwrap();
    }
    let storage = Storage::new(
        dir.path().into(),
        Arc::new(Db::open(&dir.path().join("index.db")).unwrap()),
    );
    (dir, storage)
}

async fn prepare(workflow: Workflow) -> Case {
    let (dir, storage) = fixture().await;
    let (old, moved, replacement) = match workflow {
        Workflow::Ordinary => (
            "notes/Untitled.md",
            "notes/Project.md",
            "# Unrelated draft\n",
        ),
        Workflow::DailyArchive => (
            "daily/2026-10-24.md",
            "notes/archive-2026-10-24.md",
            "# Fresh daily\n",
        ),
        Workflow::BackupRestore => (
            "notes/inbox.md",
            "notes/archived-inbox.md",
            "# Pre-save backup\n",
        ),
    };
    fs::write(dir.path().join(old), "# Pre-save backup\n")
        .await
        .unwrap();
    storage.rebuild_from_vault().await.unwrap();
    let id = storage.list_notes().await.unwrap()[0].id;
    storage.update_note(id, "# Saved original\n").await.unwrap();
    let saved = fs::read(dir.path().join(old)).await.unwrap();
    fs::rename(dir.path().join(old), dir.path().join(moved))
        .await
        .unwrap();
    fs::write(dir.path().join(old), replacement).await.unwrap();
    Case {
        dir,
        storage,
        id,
        old,
        moved,
        saved,
        replacement,
    }
}

fn generation(path: &str, n: u64) -> Uuid {
    let mut hash = Sha256::new();
    hash.update(b"coxinha:legacy-note:v1\0");
    hash.update(path.as_bytes());
    if n != 0 {
        hash.update(format!("\0generation:{n}").as_bytes());
    }
    let digest = hash.finalize();
    let mut bytes: [u8; 16] = digest[..16].try_into().unwrap();
    bytes[6] = (bytes[6] & 15) | 128;
    bytes[8] = (bytes[8] & 63) | 128;
    Uuid::from_bytes(bytes)
}

async fn assert_stale_save_rejected(workflow: Workflow) {
    let c = prepare(workflow).await;
    let result = c.storage.update_note(c.id, "# Pending editor text\n").await;
    eprintln!(
        "stale save {}: {:?}",
        c.old,
        result.as_ref().map(|_| ()).map_err(|e| e.to_string())
    );
    assert_eq!(
        fs::read_to_string(c.dir.path().join(c.old)).await.unwrap(),
        c.replacement,
        "F-A: a stale save must preserve the unrelated replacement bytes"
    );
    assert_eq!(fs::read(c.dir.path().join(c.moved)).await.unwrap(), c.saved);
    assert_eq!(
        result.unwrap_err().to_string(),
        "note_file_changed_externally"
    );
    assert!(c.storage.search_notes("Pending").await.unwrap().is_empty());
}

async fn assert_rebuild_recovers(workflow: Workflow) {
    let c = prepare(workflow).await;
    let replacement_id = generation(c.old, 1);
    for _ in 0..2 {
        let stats = c
            .storage
            .rebuild_from_vault()
            .await
            .expect("F-B: path reuse must rebuild successfully");
        assert_eq!(stats.notes_indexed, 2);
        assert_eq!(stats.notes_skipped, 0);
        assert_eq!(c.storage.get_note(c.id).await.unwrap().note.path, c.moved);
        let fresh = c.storage.get_note(replacement_id).await.unwrap();
        assert_eq!(fresh.note.path, c.old);
        assert_eq!(fresh.markdown, c.replacement);
        assert_eq!(fs::read(c.dir.path().join(c.moved)).await.unwrap(), c.saved);
        assert_eq!(
            fs::read_to_string(c.dir.path().join(c.old)).await.unwrap(),
            c.replacement
        );
    }
    drop(c.storage);
    fs::remove_file(c.dir.path().join("index.db"))
        .await
        .unwrap();
    let storage = Storage::new(
        c.dir.path().into(),
        Arc::new(Db::open(&c.dir.path().join("index.db")).unwrap()),
    );
    storage.rebuild_from_vault().await.unwrap();
    assert_eq!(storage.get_note(c.id).await.unwrap().note.path, c.moved);
    assert_eq!(
        storage.get_note(replacement_id).await.unwrap().markdown,
        c.replacement
    );
}

#[tokio::test]
async fn red_f_a_ordinary_stale_save_does_not_clobber() {
    assert_stale_save_rejected(Workflow::Ordinary).await;
}
#[tokio::test]
async fn red_f_a_daily_archive_stale_save_does_not_clobber() {
    assert_stale_save_rejected(Workflow::DailyArchive).await;
}
#[tokio::test]
async fn red_f_a_backup_restore_stale_save_does_not_clobber() {
    assert_stale_save_rejected(Workflow::BackupRestore).await;
}
#[tokio::test]
async fn red_f_b_ordinary_reuse_rebuilds() {
    assert_rebuild_recovers(Workflow::Ordinary).await;
}
#[tokio::test]
async fn red_f_b_daily_archive_reuse_rebuilds() {
    assert_rebuild_recovers(Workflow::DailyArchive).await;
}
#[tokio::test]
async fn red_f_b_backup_restore_reuse_rebuilds() {
    assert_rebuild_recovers(Workflow::BackupRestore).await;
}
