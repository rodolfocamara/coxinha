use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Source {
    pub name: String,
    pub description: String,
    pub monitor: bool,
    #[serde(default)]
    pub is_default: bool,
}

fn pactl(args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("pactl")
        .args(args)
        .output()
        .context("pactl is required for the explicit Pulse/PipeWire adapter")?;
    ensure!(
        output.status.success(),
        "Pulse device enumeration failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output.stdout)
}

fn default_name(kind: &str) -> String {
    pactl(&[kind])
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default()
        .trim()
        .to_owned()
}

pub fn list_sources() -> Result<Vec<Source>> {
    let sources: Vec<Value> = serde_json::from_slice(&pactl(&["-f", "json", "list", "sources"])?)?;
    // Defaults are hints, not prerequisites for explicit manual selection.
    let sinks: Vec<Value> = pactl(&["-f", "json", "list", "sinks"])
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    parse_sources(
        &sources,
        &sinks,
        &default_name("get-default-source"),
        &default_name("get-default-sink"),
    )
}

fn parse_sources(
    sources: &[Value],
    sinks: &[Value],
    mic: &str,
    output: &str,
) -> Result<Vec<Source>> {
    sources.iter().map(|source| {
        let name = source["name"].as_str().context("source name missing")?;
        let sink = sinks.iter().find(|sink| {
            sink["monitor_source_name"].as_str() == Some(name)
                || sink["monitor_source"].as_str() == Some(name)
                || matches!((sink["monitor_source"].as_u64(), source["index"].as_u64()), (Some(a), Some(b)) if a == b)
        });
        let monitor = sink.is_some()
            || source["properties"]["device.class"].as_str() == Some("monitor")
            || source["monitor_of_sink"].as_u64().is_some_and(|v| v != u32::MAX as u64)
            || source["monitor_source"].as_str().is_some_and(|v| !v.is_empty());
        let is_default = if monitor {
            !output.is_empty() && (sink.is_some_and(|s| s["name"].as_str() == Some(output))
                || source["monitor_source"].as_str() == Some(output))
        } else { !mic.is_empty() && name == mic };
        Ok(Source { name: name.into(), description: source["description"].as_str().unwrap_or(name).into(), monitor, is_default })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pipewire_defaults_are_independent_and_match_actual_monitors() {
        let sources = vec![
            json!({"name":"webcam", "monitor_source":""}),
            json!({"name":"vocaster-mic","monitor_source":""}),
            json!({"name":"vocaster-output.monitor","monitor_source":"vocaster-output"}),
            json!({"name":"other.monitor","monitor_source":"other"}),
        ];
        let sources = parse_sources(&sources, &[], "vocaster-mic", "vocaster-output").unwrap();
        assert!(!sources[0].is_default);
        assert!(sources[1].is_default && !sources[1].monitor);
        assert!(sources[2].is_default && sources[2].monitor);
        assert!(!sources[3].is_default && sources[3].monitor);
    }

    #[test]
    fn pulse_numeric_and_named_sink_monitors_resolve_without_name_guessing() {
        for sink in [
            json!({"name":"headphones","monitor_source":42}),
            json!({"name":"headphones","monitor_source_name":"custom-loopback"}),
            json!({"name":"headphones","monitor_source":"custom-loopback"}),
        ] {
            let sources = parse_sources(
                &[
                    json!({"name":"mic","monitor_of_sink":4294967295u64}),
                    json!({"name":"custom-loopback","index":42,"monitor_of_sink":7}),
                ],
                &[sink],
                "mic",
                "headphones",
            )
            .unwrap();
            assert!(sources[0].is_default && !sources[0].monitor);
            assert!(sources[1].is_default && sources[1].monitor);
        }
    }

    #[test]
    fn absent_defaults_and_monitor_as_default_source_never_invent_a_microphone() {
        let input = vec![
            json!({"name":"mic"}),
            json!({"name":"monitor","properties":{"device.class":"monitor"}}),
        ];
        for mic in ["", "missing", "monitor"] {
            let sources = parse_sources(&input, &[], mic, "missing").unwrap();
            assert!(sources.iter().all(|s| !s.is_default));
            assert!(sources[1].monitor);
        }
    }
}
