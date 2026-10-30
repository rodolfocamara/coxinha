use super::*;

fn fixture() -> (tempfile::TempDir, PathBuf, OsString) {
    let dir = tempfile::Builder::new()
        .prefix("coxinha-native-test-")
        .tempdir()
        .unwrap();
    let root = dir.path().canonicalize().unwrap();
    let token = uuid::Uuid::new_v4().to_string();
    std::fs::write(root.join(MARKER), &token).unwrap();
    for sub in [
        "vault", "app-data", "logs", "webview", "config", "cache", "home", "tmp",
    ] {
        std::fs::create_dir(root.join(sub)).unwrap();
    }
    (dir, root, token.into())
}

#[test]
fn absent_profile_keeps_production_resolution_and_partial_profile_fails_closed() {
    assert!(TestProfile::resolve(None, None).unwrap().is_none());
    assert!(TestProfile::resolve(Some("relative".into()), None).is_err());
    assert!(TestProfile::resolve(None, Some("token".into())).is_err());
    // Even a present empty root must never turn into a default path.
    assert!(TestProfile::resolve(
        Some("".into()),
        Some(uuid::Uuid::new_v4().to_string().into())
    )
    .is_err());
}

#[test]
fn all_application_paths_are_inside_explicit_profile_on_every_platform() {
    let (_dir, root, token) = fixture();
    let p = TestProfile::resolve(Some(root.clone().into_os_string()), Some(token))
        .unwrap()
        .unwrap();
    assert_eq!(p.vault(), root.join("vault"));
    assert_eq!(p.library(), root.join("app-data/meeting-library"));
    assert_eq!(p.logs(), root.join("logs"));
    assert_eq!(p.webview(), root.join("webview"));
}

#[test]
fn wrong_marker_missing_subtree_relative_and_traversal_profiles_are_refused() {
    let (_dir, root, token) = fixture();
    let resolve = |path: PathBuf, token: OsString| {
        TestProfile::resolve(Some(path.into_os_string()), Some(token))
    };
    assert!(resolve(root.clone(), uuid::Uuid::new_v4().to_string().into()).is_err());
    assert!(resolve(PathBuf::from("coxinha-native-test-relative"), token.clone()).is_err());
    assert!(resolve(root.join("vault/.."), token.clone()).is_err());
    std::fs::remove_dir(root.join("cache")).unwrap();
    assert!(resolve(root, token).is_err());
}

#[cfg(unix)]
#[test]
fn symlink_subtree_and_marker_never_escape_profile() {
    let (_dir, root, token) = fixture();
    let other = tempfile::tempdir().unwrap();
    std::fs::remove_dir(root.join("vault")).unwrap();
    std::os::unix::fs::symlink(other.path(), root.join("vault")).unwrap();
    assert!(
        TestProfile::resolve(Some(root.clone().into_os_string()), Some(token.clone())).is_err()
    );
    std::fs::remove_file(root.join("vault")).unwrap();
    std::fs::create_dir(root.join("vault")).unwrap();
    let marker = root.join(MARKER);
    std::fs::rename(&marker, root.join("saved-marker")).unwrap();
    std::os::unix::fs::symlink(root.join("saved-marker"), marker).unwrap();
    assert!(TestProfile::resolve(Some(root.into_os_string()), Some(token)).is_err());
}
