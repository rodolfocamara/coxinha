use coxinha_core::capture::CaptureManifest;
use serde_json::{json, Value};
use std::path::Path;

// Presentation-only stats, never an audio grant or a durability acknowledgement.
pub(super) fn snapshot(root: &Path, id: &str, manifest: Option<&CaptureManifest>) -> Value {
    if uuid::Uuid::parse_str(id).is_err() {
        return Value::Null;
    }
    let directory = root.join("raw").join(id);
    let owned = root.canonicalize().ok().is_some_and(|root| {
        directory
            .canonicalize()
            .is_ok_and(|path| path == root.join("raw").join(id))
    });
    let names: &[&str] = if manifest.is_some_and(|m| m.version == 2) {
        &["imported.wav"]
    } else {
        &["mic.wav", "output.wav"]
    };
    let mut total = Some(0u64);
    let mut duration = Some(0u64);
    let files: Vec<_> = names
        .iter()
        .map(|name| {
            let bytes = owned
                .then(|| std::fs::symlink_metadata(directory.join(name)).ok())
                .flatten()
                .filter(|m| m.is_file())
                .map(|m| m.len());
            total = total.zip(bytes).and_then(|(a, b)| a.checked_add(b));
            let ms = match manifest {
                Some(m) => m
                    .tracks
                    .iter()
                    .find(|t| t.file == *name)
                    .filter(|_| m.sample_rate > 0)
                    .and_then(|t| t.frames.checked_mul(1000))
                    .map(|n| n / u64::from(m.sample_rate)),
                // The live recorder writes fixed-header, mono PCM16 at 48 kHz.
                None => bytes.and_then(|n| n.checked_sub(44)).map(|n| n / 96),
            };
            duration = duration.zip(ms).map(|(a, b)| a.max(b));
            json!({"name":name,"bytes":bytes})
        })
        .collect();
    json!({"directory":directory,"files":files,"totalBytes":total,"durationMs":duration})
}

#[cfg(test)]
mod tests {
    use super::*;
    use coxinha_core::{
        capture::{Recording, Track},
        store::Store,
    };

    #[test]
    fn real_recording_stats_are_audio_only_and_do_not_modify_files() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path()).unwrap();
        let id = store.create_meeting("stats").unwrap();
        let mut capture = Recording::start(&store, &id, "fake-mic", "fake-output").unwrap();
        capture.write_block(Track::Mic, &[0; 2400], 1).unwrap();
        capture.write_block(Track::Output, &[0; 1200], 1).unwrap();
        let live = snapshot(&store.root, &id, None);
        assert_eq!(live["totalBytes"], 7288);
        assert_eq!(live["durationMs"], 50);
        capture.pause(true, 2).unwrap();
        capture
            .write_block(Track::Mic, &[0; 2400], 1000000)
            .unwrap();
        assert_eq!(snapshot(&store.root, &id, None), live);
        let manifest = capture.finish(&store, false).unwrap();
        let before = std::fs::read(store.root.join("raw").join(&id).join("mic.wav")).unwrap();
        let saved = snapshot(&store.root, &id, Some(&manifest));
        assert_eq!(saved["totalBytes"], 7288);
        assert_eq!(saved["durationMs"], 50);
        assert_eq!(
            std::fs::read(store.root.join("raw").join(&id).join("mic.wav")).unwrap(),
            before
        );
    }

    #[test]
    fn missing_files_are_unknown_and_invalid_ids_cannot_escape() {
        let temp = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let value = snapshot(temp.path(), &id, None);
        assert!(value["totalBytes"].is_null());
        assert!(value["durationMs"].is_null());
        assert!(snapshot(temp.path(), "../outside", None).is_null());
    }

    #[test]
    fn imported_duration_uses_manifest_frames_not_fixed_header_assumptions() {
        let temp = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let directory = temp.path().join("raw").join(&id);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("imported.wav"), [0; 200]).unwrap();
        let manifest: CaptureManifest = serde_json::from_value(json!({
            "version":2,"meeting":id,"state":"finished","sample_rate":48000,"channels":1,
            "clock":"import","alignment":"single source","tracks":[{
                "source":"import","file":"imported.wav","frames":48000,
                "first_arrival_ns":null,"last_arrival_ns":null,"sha256":null
            }]
        }))
        .unwrap();
        let value = snapshot(temp.path(), &id, Some(&manifest));
        assert_eq!(value["durationMs"], 1000);
        assert_eq!(value["totalBytes"], 200);
        assert_eq!(value["files"].as_array().unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn file_and_directory_symlinks_are_not_statted() {
        let temp = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let dir = temp.path().join("raw").join(&id);
        std::fs::create_dir_all(&dir).unwrap();
        let outside = temp.path().join("private");
        std::fs::write(&outside, [0; 100]).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("mic.wav")).unwrap();
        assert!(snapshot(temp.path(), &id, None)["files"][0]["bytes"].is_null());
        let other = uuid::Uuid::new_v4().to_string();
        std::os::unix::fs::symlink(&dir, temp.path().join("raw").join(&other)).unwrap();
        assert!(snapshot(temp.path(), &other, None)["totalBytes"].is_null());
    }
}
