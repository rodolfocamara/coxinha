//! Suggested meeting titles from a user-owned LLM over SSH (spec 0097 P4,
//! ADR 0024). Only a capped transcript excerpt leaves the computer, through
//! the system `ssh` client in stdio mode; the answer is a Memory suggestion.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::ffi::{OsStr, OsString};
use std::net::{Ipv4Addr, Ipv6Addr};
use std::time::Duration;

mod excerpt;
mod sanitize;
mod transport;

pub use excerpt::{build_excerpt, estimate_tokens, ExcerptMode, TranscriptLine};
pub use sanitize::sanitize_title;

/// ADR 0024 item 1: at most this many transcript tokens per request.
pub const MAX_EXCERPT_TOKENS: usize = 1500;
/// The first suggestion uses this many minutes; the refined one samples.
pub const FIRST_TITLE_MINUTES: u64 = 5;
const TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(windows)]
const SSH_PROGRAM: &str = "ssh.exe";
#[cfg(not(windows))]
const SSH_PROGRAM: &str = "ssh";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct TitleLlmSettings {
    pub enabled: bool,
    pub ssh_target: String,
    pub remote_port: u16,
    pub model: String,
}

impl Default for TitleLlmSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            ssh_target: String::new(),
            remote_port: 8000,
            model: "qwen3.5-4b".into(),
        }
    }
}

impl TitleLlmSettings {
    /// An empty target is allowed only while disabled, so the default saves.
    pub fn validate(&self) -> Result<(), String> {
        if self.enabled || !self.ssh_target.is_empty() {
            validate_target(&self.ssh_target)?;
        }
        if self.remote_port == 0 {
            return Err("remote port must be between 1 and 65535".into());
        }
        let model = self.model.trim();
        if model.is_empty() || model.len() > 128 || model.chars().any(char::is_control) {
            return Err("model must be a non-empty name of at most 128 characters".into());
        }
        Ok(())
    }
}

/// `user@host`, where nothing can be read by `ssh` as an option.
fn validate_target(target: &str) -> Result<(), String> {
    let invalid = || Err(format!("ssh target must be user@host, got {target:?}"));
    if target.starts_with('-') || target.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return invalid();
    }
    let Some((user, host)) = target.split_once('@') else {
        return invalid();
    };
    let user_ok = !user.is_empty()
        && user.len() <= 64
        && !user.starts_with('-')
        && user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !user_ok || !valid_host(host) {
        return invalid();
    }
    Ok(())
}

fn valid_host(host: &str) -> bool {
    if host.parse::<Ipv4Addr>().is_ok() || host.parse::<Ipv6Addr>().is_ok() {
        return true;
    }
    // Digits-and-dots that failed the IPv4 parse are a typo, not a name.
    if host.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return false;
    }
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

/// The `ssh -W` command line (spec 0097 P4, should-fix 9). The user's own
/// SSH configuration supplies keys and known hosts; Coxinha stores none.
fn ssh_args(settings: &TitleLlmSettings) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        "-W".into(),
        format!("127.0.0.1:{}", settings.remote_port).into(),
    ];
    for option in [
        "BatchMode=yes",
        "ControlMaster=no",
        "ControlPath=none",
        "StrictHostKeyChecking=yes",
        "ConnectTimeout=5",
        "ServerAliveInterval=5",
        "ForwardAgent=no",
        "PermitLocalCommand=no",
    ] {
        args.push("-o".into());
        args.push(option.into());
    }
    args.push("--".into());
    args.push(settings.ssh_target.clone().into());
    args
}

/// Asks the configured endpoint for a title. Fails, without fallback, when
/// the setting is off or invalid, the host is unreachable or the answer is
/// unusable; the caller then keeps the placeholder.
pub async fn suggest_title(settings: &TitleLlmSettings, excerpt: &str) -> Result<String, String> {
    suggest_with(
        OsStr::new(SSH_PROGRAM),
        &ssh_args(settings),
        settings,
        excerpt,
        TIMEOUT,
    )
    .await
}

async fn suggest_with(
    program: &OsStr,
    args: &[OsString],
    settings: &TitleLlmSettings,
    excerpt: &str,
    timeout: Duration,
) -> Result<String, String> {
    if !settings.enabled {
        return Err("title suggestions are disabled".into());
    }
    settings.validate()?;
    if excerpt.trim().is_empty() {
        return Err("empty transcript excerpt".into());
    }
    let body = transport::request_body(&settings.model, excerpt);
    let raw = transport::complete(program, args, settings.remote_port, body, timeout).await?;
    sanitize_title(&raw).ok_or_else(|| "the model returned no usable title".into())
}

#[cfg(test)]
mod tests;
