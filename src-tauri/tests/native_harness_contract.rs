//! Hermetic only: builds commands and resolves paths, never executes a program.
mod support;

#[test]
fn command_routes_every_data_class_into_one_fresh_profile() {
    // Compile-time ownership contract: launching must consume the sandbox and
    // return the RAII owner. Referencing its type does not execute the launcher.
    #[cfg(feature = "native-smoke-tests")]
    let _native_launcher: fn(support::NativeSandbox, &std::path::Path) -> support::ChildGuard =
        support::NativeSandbox::spawn;
    let sandbox = support::NativeSandbox::new();
    let command = sandbox.command(std::path::Path::new("not-executed"));
    let env: std::collections::HashMap<_, _> = command
        .get_envs()
        .map(|(k, v)| (k.to_str().unwrap(), v.unwrap().to_owned()))
        .collect();
    let root = std::path::PathBuf::from(&env["COXINHA_NATIVE_TEST_ROOT"]);
    assert!(root.is_absolute());
    assert_eq!(command.get_current_dir(), Some(root.as_path()));
    for key in [
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_DATA_HOME",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_STATE_HOME",
        "TMPDIR",
        "TMP",
        "TEMP",
        "COXINHA_VAULT",
    ] {
        let value = std::path::Path::new(&env[key]);
        assert!(value.starts_with(&root), "{key} escapes profile");
        assert_ne!(value, root);
    }
    assert!(!env.contains_key("COXINHA_LIBRARY"));
    assert!(!env.contains_key("WEBVIEW2_USER_DATA_FOLDER"));
    let other = support::NativeSandbox::new();
    assert_ne!(
        other
            .command(std::path::Path::new("not-executed"))
            .get_current_dir(),
        command.get_current_dir()
    );
    drop(sandbox);
    assert!(!root.exists());
}

#[test]
fn native_targets_require_explicit_feature_and_remain_ignored() {
    let manifest: toml::Value = toml::from_str(include_str!("../Cargo.toml")).unwrap();
    let targets = manifest["test"].as_array().unwrap();
    for (name, source) in [
        ("boot_smoke", include_str!("boot_smoke.rs")),
        ("perf_smoke", include_str!("perf_smoke.rs")),
        ("shortcut_smoke", include_str!("shortcut_smoke.rs")),
    ] {
        let target = targets
            .iter()
            .find(|t| t["name"].as_str() == Some(name))
            .unwrap();
        assert_eq!(
            target["required-features"][0].as_str(),
            Some("native-smoke-tests")
        );
        assert!(source.contains("#[ignore = \"native app:"));
        assert!(source.contains("sandbox.spawn("));
        assert!(!source.contains("Command::new"));
    }
    // This remains a pure Storage benchmark with a TempDir, no process launch.
    let latency = include_str!("perf_new_note.rs");
    assert!(!latency.contains("Command::new"));
    assert!(!latency.contains(".spawn("));
}
