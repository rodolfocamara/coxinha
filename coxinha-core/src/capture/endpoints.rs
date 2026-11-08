//! Platform-neutral half of the Windows adapter (spec 0133): source naming and
//! block framing. Compiled everywhere so Linux CI tests it.
#![cfg_attr(not(windows), allow(dead_code))]
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Source {
    pub name: String,
    pub description: String,
    pub monitor: bool,
    #[serde(default)]
    pub is_default: bool,
    /// Spec 0133: "no device of this kind"; the track is written as silence.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub absent: bool,
}

/// One active endpoint as the OS reports it.
#[derive(Clone, Debug)]
pub struct Endpoint {
    pub id: String,
    pub name: String,
}

const PREFIX: &str = "wasapi:";

fn kind(monitor: bool) -> &'static str {
    if monitor {
        "output"
    } else {
        "input"
    }
}

/// Defaults first, then the other endpoints, then `none` only for an empty kind.
pub fn build_sources(
    inputs: &[Endpoint],
    outputs: &[Endpoint],
    default_input: Option<&str>,
    default_output: Option<&str>,
) -> Result<Vec<Source>> {
    ensure!(
        !inputs.is_empty() || !outputs.is_empty(),
        "no active audio input or output on this computer"
    );
    let mut sources = Vec::new();
    for (list, default, monitor) in [
        (inputs, default_input, false),
        (outputs, default_output, true),
    ] {
        let kind = kind(monitor);
        if list.is_empty() {
            sources.push(Source {
                name: format!("{PREFIX}none-{kind}"),
                description: if monitor {
                    "No computer audio"
                } else {
                    "No microphone"
                }
                .into(),
                monitor,
                is_default: true,
                absent: true,
            });
            continue;
        }
        let default = default.and_then(|id| list.iter().find(|e| e.id == id));
        if let Some(endpoint) = default {
            sources.push(Source {
                name: format!("{PREFIX}default-{kind}"),
                description: endpoint.name.clone(),
                monitor,
                is_default: true,
                absent: false,
            });
        }
        for endpoint in list.iter().filter(|e| default.is_none_or(|d| d.id != e.id)) {
            sources.push(Source {
                name: format!("{PREFIX}{}", endpoint.id),
                description: endpoint.name.clone(),
                monitor,
                is_default: false,
                absent: false,
            });
        }
    }
    Ok(sources)
}

/// What a source name asks the adapter to record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Choice {
    /// Follow the system default endpoint of this kind.
    Default,
    /// This endpoint only; no fallback.
    Endpoint(String),
    /// No endpoint of this kind exists: write silence.
    Absent,
}

impl Choice {
    pub fn parse(name: &str, monitor: bool) -> Result<Self> {
        let rest = name
            .strip_prefix(PREFIX)
            .context("not a Windows audio source")?;
        let kind = kind(monitor);
        if rest == format!("default-{kind}") {
            return Ok(Self::Default);
        }
        if rest == format!("none-{kind}") {
            return Ok(Self::Absent);
        }
        if rest.starts_with("default-") || rest.starts_with("none-") || rest.is_empty() {
            bail!("source {name} is not a valid {kind}");
        }
        Ok(Self::Endpoint(rest.into()))
    }
}

/// Samples per block, as `parec --latency-msec=20` delivers on Linux.
pub const BLOCK: usize = 960;

/// Cuts packets of any size into 20 ms blocks; a tail under 20 ms waits.
#[derive(Default)]
pub struct Framer {
    pending: Vec<i16>,
}

impl Framer {
    pub fn push(&mut self, samples: &[i16]) -> Vec<Vec<i16>> {
        self.pending.extend_from_slice(samples);
        let whole = self.pending.len() / BLOCK * BLOCK;
        let blocks = self.pending[..whole]
            .as_chunks::<BLOCK>()
            .0
            .iter()
            .map(|block| block.to_vec())
            .collect();
        self.pending.drain(..whole);
        blocks
    }
    #[cfg(test)]
    pub fn pending(&self) -> usize {
        self.pending.len()
    }
}

/// Little-endian 16-bit PCM bytes to samples.
pub fn decode(bytes: &[u8]) -> Vec<i16> {
    bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes(*b))
        .collect()
}

#[cfg(test)]
#[path = "endpoints_tests.rs"]
mod tests;
