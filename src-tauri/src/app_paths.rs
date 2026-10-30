//! Explicit disposable native-test profile. Production defaults remain caller-owned.
use anyhow::{ensure, Context, Result};
use std::ffi::OsString;
use std::path::PathBuf;

pub(crate) const ROOT_ENV: &str = "COXINHA_NATIVE_TEST_ROOT";
pub(crate) const TOKEN_ENV: &str = "COXINHA_NATIVE_TEST_TOKEN";
pub(crate) const MARKER: &str = ".coxinha-native-test";

#[derive(Clone, Debug)]
pub(crate) struct TestProfile {
    pub(crate) root: PathBuf,
}

impl TestProfile {
    pub(crate) fn from_env() -> Result<Option<Self>> {
        let root = std::env::var_os(ROOT_ENV);
        let token = std::env::var_os(TOKEN_ENV);
        if root.is_some() || token.is_some() {
            ensure!(
                cfg!(feature = "native-smoke-tests"),
                "native test profile requires native-smoke-tests feature"
            );
        }
        Self::resolve(root, token)
    }

    // Explicit inputs let contracts run without mutating process-global environment.
    pub(crate) fn resolve(root: Option<OsString>, token: Option<OsString>) -> Result<Option<Self>> {
        let (root, token) = match (root, token) {
            (None, None) => return Ok(None),
            (Some(root), Some(token)) => (PathBuf::from(root), token),
            _ => anyhow::bail!("incomplete native test profile"),
        };
        let token = token.to_str().context("invalid native test token")?;
        ensure!(
            !uuid::Uuid::parse_str(token)?.is_nil(),
            "nil native test token"
        );
        ensure!(
            root.is_absolute() && root.is_dir(),
            "native test root must be an existing absolute directory"
        );
        ensure!(
            root.canonicalize()? == root,
            "native test root must be canonical without symlinks"
        );
        ensure!(
            root.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("coxinha-native-test-")),
            "unexpected native test root name"
        );
        let marker = root.join(MARKER);
        ensure!(
            std::fs::symlink_metadata(&marker)?.is_file(),
            "native test marker must be a regular file"
        );
        ensure!(
            std::fs::read_to_string(marker)? == token,
            "native test marker mismatch"
        );
        // Never follow a preexisting profile subtree out of the disposable root.
        for sub in [
            "vault", "app-data", "logs", "webview", "config", "cache", "home", "tmp",
        ] {
            let path = root.join(sub);
            ensure!(
                path.is_dir() && path.canonicalize()? == path,
                "invalid native test subtree"
            );
        }
        Ok(Some(Self { root }))
    }

    pub(crate) fn vault(&self) -> PathBuf {
        self.root.join("vault")
    }
    pub(crate) fn library(&self) -> PathBuf {
        self.root.join("app-data/meeting-library")
    }
    pub(crate) fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }
    pub(crate) fn webview(&self) -> PathBuf {
        self.root.join("webview")
    }
}

#[cfg(test)]
#[path = "app_paths/tests.rs"]
mod tests;
