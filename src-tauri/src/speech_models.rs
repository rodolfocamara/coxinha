//! Where speech models come from (spec 0099): the transcription model is the
//! one Handy already installed, else one the user downloaded into the app;
//! the speaker models ship next to the binary.
use std::path::{Path, PathBuf};

/// Public fallback when no local model exists (CC-BY-4.0, transcribe.cpp format).
pub const FALLBACK_URL: &str = "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/d8d8c32cb2017c57e5307767343e97870f8a7f53/parakeet-tdt-0.6b-v3-Q8_0.gguf";
pub const FALLBACK_FILE: &str = "parakeet-tdt-0.6b-v3-Q8_0.gguf";
pub const FALLBACK_SHA256: &str =
    "5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7";
pub const FALLBACK_BYTES: u64 = 739_508_576;

/// Lower is better. Tagarela wins on spontaneous pt-BR (spec 0098 P4).
fn rank(name: &str) -> Option<u8> {
    let name = name.to_ascii_lowercase();
    if !name.ends_with(".gguf") || name.starts_with('.') {
        return None;
    }
    if name.contains("tagarela") {
        Some(if name.contains("matched") { 0 } else { 1 })
    } else if name.contains("parakeet-ultra") {
        Some(2)
    } else if name.contains("parakeet") && name.contains("v3") {
        Some(3)
    } else {
        None
    }
}

pub fn pick(files: &[PathBuf]) -> Option<PathBuf> {
    files
        .iter()
        .filter_map(|p| Some((rank(p.file_name()?.to_str()?)?, p)))
        .min_by_key(|(r, p)| (*r, p.as_os_str().len()))
        .map(|(_, p)| p.clone())
}

fn host_data_dir() -> Option<PathBuf> {
    // The local launcher isolates XDG_DATA_HOME; Handy lives in the host's.
    let host = std::env::var_os("COXINHA_HOST_XDG_DATA_HOME").filter(|v| !v.is_empty());
    if cfg!(target_os = "windows") {
        return std::env::var_os("APPDATA").map(PathBuf::from);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    if cfg!(target_os = "macos") {
        return Some(home.join("Library/Application Support"));
    }
    Some(
        host.map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share")),
    )
}

fn gguf_files(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.is_file())
                .collect()
        })
        .unwrap_or_default()
}

/// Handy's models first, then the app's own `models` directory.
pub fn detect(app_models: &Path) -> Option<PathBuf> {
    let handy = host_data_dir().map(|d| d.join("com.pais.handy").join("models"));
    handy
        .and_then(|d| pick(&gguf_files(&d)))
        .or_else(|| pick(&gguf_files(app_models)))
}

#[cfg(target_os = "windows")]
const ORT_LIB: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
const ORT_LIB: &str = "libonnxruntime.1.22.0.dylib";
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
const ORT_LIB: &str = "libonnxruntime.so.1.22.0";

/// The bundled speaker models: next to the binary, or in the package's lib dir.
pub fn speaker_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let base = exe.parent()?;
    [base.join("speech"), base.join("../lib/Coxinha/speech")]
        .into_iter()
        .find(|d| {
            ["segmentation.onnx", "wespeaker.onnx", ORT_LIB]
                .iter()
                .all(|f| d.join(f).is_file())
        })
}

/// Automatic runs end in `-live`; a meeting whose runs are all automatic and
/// older than this one is separated again (spec 0101).
pub const AUTOMATIC_ENGINE: &str = "coxinha-local-cpu-v3-live";

pub fn superseded(versions: &[String]) -> bool {
    versions
        .iter()
        .all(|v| v.ends_with("-live") && v != AUTOMATIC_ENGINE)
}

/// Processing config for automatic speaker separation over the live
/// transcript. Hashing ~55 MB runs on the caller's (worker) thread.
pub fn processing_config(dir: &Path) -> anyhow::Result<serde_json::Value> {
    let model = |file: &str, provenance: &str| -> anyhow::Result<serde_json::Value> {
        let path = dir.join(file).canonicalize()?;
        let (sha256, _) = coxinha_core::artifacts::digest(&path)?;
        Ok(serde_json::json!({ "path": path, "sha256": sha256, "provenance": provenance }))
    };
    Ok(serde_json::json!({
        "engine_version": AUTOMATIC_ENGINE,
        "models": {
            "segmentation": model("segmentation.onnx", "https://huggingface.co/onnx-community/pyannote-segmentation-3.0/tree/733a93b6473d019a773298e08cefa686894b1854; declared license MIT; bundled with Coxinha")?,
            "embedding": model("wespeaker.onnx", "https://huggingface.co/WeSpeaker/wespeaker-voxceleb-resnet34-LM/tree/f0c48c298fd835726c27956a5d617bad7115627e; CC-BY-4.0; bundled with Coxinha")?,
            "onnxruntime": model(ORT_LIB, "https://github.com/microsoft/onnxruntime/releases/tag/v1.22.0; Microsoft ONNX Runtime 1.22.0 CPU, MIT; bundled with Coxinha")?,
        },
        "parameters": {
            "transcript": "live",
            "maximum_duration_seconds": 7200,
            "embedding_family": "WeSpeaker/wespeaker-voxceleb-resnet34-LM",
            "embedding_revision": "f0c48c298fd835726c27956a5d617bad7115627e",
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_older_automatic_runs_are_redone() {
        let v = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(superseded(&v(&[])));
        assert!(superseded(&v(&["coxinha-local-cpu-v2-live"])));
        assert!(!superseded(&v(&[
            "coxinha-local-cpu-v2-live",
            AUTOMATIC_ENGINE
        ])));
        // A run the owner configured by hand is never redone automatically.
        assert!(!superseded(&v(&["coxinha-local-cpu-v1"])));
        assert!(!superseded(&v(&[""])));
    }

    #[test]
    fn prefers_tagarela_then_ultra_then_v3_and_ignores_other_files() {
        let files = |names: &[&str]| names.iter().map(PathBuf::from).collect::<Vec<_>>();
        let all = files(&[
            "/m/Qwen3-ASR-1.7B-Q8_0.gguf",
            "/m/parakeet-tdt-0.6b-v3-Q8_0.gguf",
            "/m/parakeet-ultra-Q8_0.gguf",
            "/m/parakeet-v3-ptbr-tagarela-q8_0.gguf",
            "/m/parakeet-v3-ptbr-tagarela-matched-q8.gguf",
            "/m/.tagarela-original-parakeet-cpp.gguf.backup",
        ]);
        assert_eq!(
            pick(&all),
            Some(PathBuf::from(
                "/m/parakeet-v3-ptbr-tagarela-matched-q8.gguf"
            ))
        );
        assert_eq!(
            pick(&all[..3]),
            Some(PathBuf::from("/m/parakeet-ultra-Q8_0.gguf"))
        );
        assert_eq!(
            pick(&all[..2]),
            Some(PathBuf::from("/m/parakeet-tdt-0.6b-v3-Q8_0.gguf"))
        );
        assert_eq!(
            pick(&files(&["/m/Qwen3-ASR-1.7B-Q8_0.gguf", "/m/notes.txt"])),
            None
        );
    }
}
