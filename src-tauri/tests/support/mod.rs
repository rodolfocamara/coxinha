//! No launch occurs during construction or contract testing.
// The production module is compiled separately; only its pure resolver is used here.
#[allow(dead_code)]
#[path = "../../src/app_paths.rs"]
mod app_paths;
use app_paths::{TestProfile, MARKER, ROOT_ENV, TOKEN_ENV};
use std::process::{Command, Stdio};

pub struct NativeSandbox {
    _directory: tempfile::TempDir,
    profile: TestProfile,
    token: String,
}

impl NativeSandbox {
    pub fn new() -> Self {
        let directory = tempfile::Builder::new()
            .prefix("coxinha-native-test-")
            .tempdir()
            .expect("disposable root");
        let root = directory
            .path()
            .canonicalize()
            .expect("canonical disposable root");
        let token = uuid::Uuid::new_v4().to_string();
        for sub in [
            "vault", "app-data", "logs", "webview", "config", "cache", "home", "tmp",
        ] {
            std::fs::create_dir(root.join(sub)).expect("private subtree");
        }
        std::fs::write(root.join(MARKER), &token).expect("profile ownership marker");
        let profile = TestProfile::resolve(Some(root.into_os_string()), Some(token.clone().into()))
            .expect("valid test profile")
            .expect("explicit profile");
        Self {
            _directory: directory,
            profile,
            token,
        }
    }

    pub fn command(&self, binary: &std::path::Path) -> Command {
        let mut command = Command::new(binary);
        // Preserve only runtime loader/desktop necessities. No inherited application
        // configuration, model, vault, data, or browser-profile overrides survive.
        command.env_clear();
        for key in [
            "PATH",
            "SystemRoot",
            "SYSTEMROOT",
            "WINDIR",
            "COMSPEC",
            "PATHEXT",
            "LD_LIBRARY_PATH",
            "DYLD_LIBRARY_PATH",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XAUTHORITY",
            "DBUS_SESSION_BUS_ADDRESS",
            "XDG_RUNTIME_DIR",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let root = &self.profile.root;
        for (key, sub) in [
            ("HOME", "home"),
            ("USERPROFILE", "home"),
            ("APPDATA", "config"),
            ("LOCALAPPDATA", "app-data"),
            ("XDG_DATA_HOME", "app-data"),
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_CACHE_HOME", "cache"),
            ("XDG_STATE_HOME", "logs"),
            ("TMPDIR", "tmp"),
            ("TMP", "tmp"),
            ("TEMP", "tmp"),
        ] {
            command.env(key, root.join(sub));
        }
        command
            .env(ROOT_ENV, root)
            .env(TOKEN_ENV, &self.token)
            .env("COXINHA_VAULT", self.profile.vault())
            .env("RUST_LOG", "coxinha=info,coxinha_lib=info")
            .current_dir(root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    #[cfg(feature = "native-smoke-tests")]
    pub fn spawn(self, binary: &std::path::Path) -> ChildGuard {
        assert_eq!(std::env::var("COXINHA_NATIVE_PRIVATE_SESSION").as_deref(), Ok("1"), "parent must provision a private desktop/session and acknowledge it; see tests/README.md");
        let child = self
            .command(binary)
            .spawn()
            .expect("spawn isolated coxinha");
        ChildGuard {
            child,
            _sandbox: self,
        }
    }
}

#[cfg(feature = "native-smoke-tests")]
pub struct ChildGuard<C: Cleanup = std::process::Child> {
    child: C,
    _sandbox: NativeSandbox,
}
#[cfg(feature = "native-smoke-tests")]
impl<C: Cleanup> std::ops::Deref for ChildGuard<C> {
    type Target = C;
    fn deref(&self) -> &Self::Target {
        &self.child
    }
}
#[cfg(feature = "native-smoke-tests")]
impl<C: Cleanup> std::ops::DerefMut for ChildGuard<C> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.child
    }
}
#[cfg(feature = "native-smoke-tests")]
impl<C: Cleanup> Drop for ChildGuard<C> {
    fn drop(&mut self) {
        // Runs on timeout, assertion/pump panic and ordinary return, before removing
        // the profile. No tray-resident process may outlive its disposable files.
        self.child.terminate();
    }
}

#[cfg(feature = "native-smoke-tests")]
pub trait Cleanup {
    fn terminate(&mut self);
}
#[cfg(feature = "native-smoke-tests")]
impl Cleanup for std::process::Child {
    fn terminate(&mut self) {
        let _ = self.kill();
        let _ = self.wait();
    }
}

#[cfg(all(test, feature = "native-smoke-tests"))]
mod cleanup_tests {
    use super::*;
    struct MockChild {
        root: std::path::PathBuf,
        cleaned: std::sync::Arc<std::sync::atomic::AtomicBool>,
    }
    impl Cleanup for MockChild {
        fn terminate(&mut self) {
            assert!(self.root.exists(), "cleanup must precede profile removal");
            self.cleaned
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    #[test]
    fn unwind_and_normal_return_clean_child_before_disposable_profile() {
        for panic in [false, true] {
            let sandbox = NativeSandbox::new();
            let root = sandbox.profile.root.clone();
            let cleaned = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let guard = ChildGuard {
                child: MockChild {
                    root: root.clone(),
                    cleaned: cleaned.clone(),
                },
                _sandbox: sandbox,
            };
            let result = std::panic::catch_unwind(move || {
                let _owner = guard;
                assert!(!panic, "simulated assertion failure");
            });
            assert_eq!(result.is_err(), panic);
            assert!(cleaned.load(std::sync::atomic::Ordering::SeqCst));
            assert!(!root.exists());
        }
    }
}
