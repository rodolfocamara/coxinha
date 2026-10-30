//! Explicit-input contracts only: never construct keyring::Entry or a native app.
use super::*;
use crate::app_paths::{TestProfile, MARKER};
use std::path::PathBuf;

fn profile() -> (tempfile::TempDir, TestProfile) {
    let dir = tempfile::Builder::new()
        .prefix("coxinha-native-test-")
        .tempdir()
        .unwrap();
    let root = dir.path().canonicalize().unwrap();
    let token = uuid::Uuid::new_v4().to_string();
    for sub in [
        "vault", "app-data", "logs", "webview", "config", "cache", "home", "tmp",
    ] {
        std::fs::create_dir(root.join(sub)).unwrap();
    }
    std::fs::write(root.join(MARKER), &token).unwrap();
    let profile = TestProfile::resolve(Some(root.into_os_string()), Some(token.into()))
        .unwrap()
        .unwrap();
    (dir, profile)
}

#[test]
fn profile_calendar_cache_and_credential_namespace_are_private_without_os_lookup() {
    let (_a, a) = profile();
    let (_b, b) = profile();
    let resolve = |profile: &TestProfile| {
        resolve_cache_path(Some(profile), || {
            panic!("profile must never consult OS appdata")
        })
    };
    let a_path = resolve(&a).unwrap();
    let b_path = resolve(&b).unwrap();
    assert_eq!(a_path, a.root.join("app-data/outlook-cache.json"));
    assert_eq!(b_path, b.root.join("app-data/outlook-cache.json"));
    assert_ne!(installation_key(&a_path), installation_key(&b_path));
    assert_ne!(
        installation_key(&a_path),
        installation_key(std::path::Path::new(
            "synthetic-production/outlook-cache.json"
        ))
    );
}

#[test]
fn absent_profile_preserves_default_path_and_invalid_profile_cannot_fall_back() {
    let calls = std::cell::Cell::new(0);
    let default = PathBuf::from("synthetic-production");
    let path = resolve_cache_path(None, || {
        calls.set(calls.get() + 1);
        Ok(default.clone())
    })
    .unwrap();
    assert_eq!(calls.get(), 1);
    assert_eq!(path, default.join("outlook-cache.json"));
    // The key algorithm and service namespace are unchanged; no OS store is called.
    assert_eq!(
        installation_key(std::path::Path::new(
            "synthetic-production/outlook-cache.json"
        )),
        "gZ2EBnpTOs7bJFHUN81DjpeH0_IMppxquxOle0i3-VE"
    );
    let result = TestProfile::resolve(Some("relative-incomplete".into()), None)
        .map_err(|_| SAFE_ERROR.to_string())
        .and_then(|profile| {
            resolve_cache_path(profile.as_ref(), || {
                panic!("invalid profile must not fall back")
            })
        });
    assert_eq!(result.unwrap_err(), SAFE_ERROR);
}
