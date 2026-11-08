use anyhow::{ensure, Context, Result};
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;

use super::Candidate;

async fn streams(kind: &str) -> Result<Vec<Value>> {
    let mut child = tokio::process::Command::new("pactl")
        .args(["-f", "json", "list", kind])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("audio metadata service unavailable")?;
    let stdout = child
        .stdout
        .take()
        .context("missing stream metadata pipe")?;
    let result = tokio::time::timeout(Duration::from_secs(2), async {
        let mut bytes = Vec::new();
        stdout
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await?;
        ensure!(bytes.len() <= 2 * 1024 * 1024, "stream metadata capacity");
        ensure!(
            child.wait().await?.success(),
            "audio metadata service failed"
        );
        Ok(serde_json::from_slice(&bytes)?)
    })
    .await;
    match result {
        Ok(Ok(rows)) => Ok(rows),
        failure => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            match failure {
                Ok(Err(e)) => Err(e),
                Err(e) => Err(e.into()),
                _ => unreachable!(),
            }
        }
    }
}

pub(super) async fn poll() -> Result<Vec<Candidate>> {
    let inputs = streams("source-outputs").await?;
    let outputs = streams("sink-inputs").await?;
    Ok(classify(&inputs, &outputs))
}

fn app(binary: &str) -> Option<(&'static str, bool)> {
    Some(match binary {
        "teams" | "teams-for-linux" | "ms-teams" | "ms-teams.exe" | "teams.exe" => {
            ("Microsoft Teams", false)
        }
        "zoom" | "zoom.exe" => ("Zoom", false),
        "webex" | "webex.exe" => ("Webex", false),
        "slack" | "slack.exe" => ("Slack", false),
        "discord" | "discord.exe" => ("Discord", false),
        "chrome" | "google-chrome" | "google-chrome-stable" => ("Google Chrome", true),
        "chromium" | "chromium-browser" => ("Chromium", true),
        "msedge" | "microsoft-edge" | "microsoft-edge-stable" => ("Microsoft Edge", true),
        "firefox" | "firefox-bin" => ("Firefox", true),
        "brave" | "brave-browser" => ("Brave", true),
        "opera" => ("Opera", true),
        _ => return None,
    })
}

#[derive(Default)]
struct Evidence {
    input: bool,
    output: bool,
    communication: bool,
}

pub(super) fn classify(inputs: &[Value], outputs: &[Value]) -> Vec<Candidate> {
    let mut groups: BTreeMap<(u32, String), Evidence> = BTreeMap::new();
    for (input, rows) in [(true, inputs), (false, outputs)] {
        for row in rows {
            if row["corked"].as_bool() != Some(false) {
                continue;
            }
            let props = &row["properties"];
            let Some(binary) = props["application.process.binary"].as_str() else {
                continue;
            };
            if binary.len() > 256 {
                continue;
            }
            let binary = binary
                .rsplit('/')
                .next()
                .unwrap_or(binary)
                .to_ascii_lowercase();
            if app(&binary).is_none() {
                continue;
            }
            let Some(pid) = props["application.process.id"]
                .as_str()
                .and_then(|s| s.parse::<u32>().ok())
                .filter(|p| *p > 0)
            else {
                continue;
            };
            let evidence = groups.entry((pid, binary)).or_default();
            evidence.input |= input;
            evidence.output |= !input;
            evidence.communication |= props["media.role"].as_str() == Some("phone")
                || props["media.name"]
                    .as_str()
                    .is_some_and(|s| s.len() <= 256 && s.to_ascii_lowercase().contains("webrtc"));
        }
    }
    groups
        .into_iter()
        .filter_map(|((pid, binary), evidence)| {
            let (name, browser) = app(&binary)?;
            let matches =
                evidence.communication || (evidence.input && (!browser || evidence.output));
            matches.then(|| Candidate {
                pid,
                process_name: binary,
                app_name: name.into(),
                is_browser: browser,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn stream(binary: &str, pid: u32, role: &str) -> Value {
        json!({"corked":false,"properties":{"application.process.binary":binary,"application.process.id":pid.to_string(),"media.role":role}})
    }
    #[test]
    fn dedicated_input_and_muted_communications_output_detect_without_samples() {
        assert_eq!(
            classify(&[stream("teams-for-linux", 1, "")], &[])[0].app_name,
            "Microsoft Teams"
        );
        assert_eq!(
            classify(&[], &[stream("zoom", 2, "phone")])[0].app_name,
            "Zoom"
        );
        assert!(classify(&[], &[stream("teams", 1, "music")]).is_empty());
    }
    #[test]
    fn browser_needs_rtc_or_duplex_and_does_not_claim_provider() {
        let chrome = stream("chrome", 1, "");
        assert!(classify(std::slice::from_ref(&chrome), &[]).is_empty());
        assert!(classify(&[], std::slice::from_ref(&chrome)).is_empty());
        let calls = classify(std::slice::from_ref(&chrome), std::slice::from_ref(&chrome));
        assert!(calls[0].is_browser);
        assert_eq!(calls[0].app_name, "Google Chrome");
        assert!(classify(&[chrome], &[stream("chrome", 2, "")]).is_empty());
        let mut rtc = stream("firefox", 3, "");
        rtc["properties"]["media.name"] = json!("WebRTC VoiceEngine");
        assert_eq!(classify(&[], &[rtc])[0].app_name, "Firefox");
    }
    #[test]
    fn own_capture_music_corked_and_missing_metadata_never_detect() {
        let mut paused = stream("teams", 1, "");
        paused["corked"] = json!(true);
        assert!(classify(
            &[
                paused,
                stream("parec", 2, "phone"),
                stream("Coxinha", 3, "phone"),
                json!({})
            ],
            &[stream("vlc", 4, "music")]
        )
        .is_empty());
    }
}
