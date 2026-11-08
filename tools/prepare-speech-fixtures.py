#!/usr/bin/env python3
"""Explicitly download pinned public fixtures/models for offline speech validation.

Requires Python 3 and ffmpeg. Does not open any microphone or user library.
Generated audio combines read speech with silence; it is not a meeting-quality benchmark.
"""
import argparse
import array
import hashlib
import json
import pathlib
import platform
import tarfile
import subprocess
import urllib.request
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS = {
    "whisper": ("ggml-tiny.bin", "ggerganov/whisper.cpp", "5359861c739e955e79d9a303bcbc70fb988958b1", "ggml-tiny.bin", "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21", "MIT"),
    "segmentation": ("segmentation.onnx", "onnx-community/pyannote-segmentation-3.0", "733a93b6473d019a773298e08cefa686894b1854", "onnx/model.onnx", "057ee564753071c0b09b5b611648b50ac188d50846bff5f01e9f7bbf1591ea25", "MIT"),
    "embedding": ("wespeaker.onnx", "WeSpeaker/wespeaker-voxceleb-resnet34-LM", "f0c48c298fd835726c27956a5d617bad7115627e", "voxceleb_resnet34_LM.onnx", "7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068", "CC-BY-4.0"),
}
SCENES = {
    "two-sources": [["6930-75918-0000"], ["1320-122617-0022"]],
    "mixed-output": [[], ["6930-75918-0000", "1320-122617-0022", "260-123286-0000"]],
    "recurrence": [["6930-75918-0002"], ["1320-122617-0023", "260-123286-0001"]],
    "in-person": [["6930-75918-0000", "1320-122617-0022", "260-123286-0000"], []],
}


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url, target, expected):
    if not target.exists():
        partial = target.with_suffix(target.suffix + ".partial")
        urllib.request.urlretrieve(url, partial)
        if sha256(partial) != expected:
            raise ValueError(f"Checksum mismatch: {partial}")
        partial.rename(target)
    if sha256(target) != expected:
        raise ValueError(f"Existing file differs from pinned artifact: {target}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "target/processing-validation")
    parser.add_argument("--download", action="store_true", help="Explicitly allow public artifact downloads")
    args = parser.parse_args()
    base = args.output.resolve()
    models, fixtures = base / "models", base / "fixtures"
    models.mkdir(parents=True, exist_ok=True)
    fixtures.mkdir(parents=True, exist_ok=True)
    config = {"engine_version": "coxinha-local-cpu-v1", "models": {}, "parameters": {
        "embedding_family": MODELS["embedding"][1], "embedding_revision": MODELS["embedding"][2],
        "cluster_cosine_threshold": 0.75, "cluster_margin": 0.08,
        "minimum_embedding_seconds": 1.0, "maximum_duration_seconds": 7200,
    }}
    for key, (name, repo, revision, filename, digest, license_name) in MODELS.items():
        path = models / name
        if not path.exists() and not args.download:
            raise ValueError("Missing model. Run with --download to allow explicit public downloads.")
        download(f"https://huggingface.co/{repo}/resolve/{revision}/{filename}", path, digest)
        config["models"][key] = {"path": str(path), "sha256": digest,
            "provenance": f"https://huggingface.co/{repo}/tree/{revision}; declared license {license_name}; explicit local validation download"}
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise ValueError("This validation runtime package is Linux x64 only; select a platform-specific runtime explicitly")
    runtime = base / "runtime"
    runtime.mkdir(exist_ok=True)
    archive = runtime / "onnxruntime-linux-x64-1.22.0.tgz"
    runtime_url = "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-linux-x64-1.22.0.tgz"
    if not archive.exists() and not args.download:
        raise ValueError("Missing runtime; use --download explicitly")
    download(runtime_url, archive, "8344d55f93d5bc5021ce342db50f62079daf39aaafb5d311a451846228be49b3")
    with tarfile.open(archive) as bundle:
        bundle.extractall(runtime, filter="data")
    library = runtime / "onnxruntime-linux-x64-1.22.0/lib/libonnxruntime.so.1.22.0"
    digest = "3da6146e14e7b8aaec625dde11d6114c7457c87a5f93d744897da8781e35c673"
    if sha256(library) != digest:
        raise ValueError("Runtime library checksum mismatch")
    config["models"]["onnxruntime"] = {"path": str(library), "sha256": digest,
        "provenance": runtime_url + "; Microsoft ONNX Runtime 1.22.0, MIT, Linux x64 CPU"}
    provenance = json.loads((ROOT / "tools/fixtures/librispeech-provenance.json").read_text())
    clips = {}
    for sample in provenance["samples"]:
        path = fixtures / (sample["id"] + ".flac")
        if not path.exists():
            if not args.download:
                raise ValueError("Missing speech fixture; use --download explicitly")
            with urllib.request.urlopen(sample["source"]) as response:
                row = json.load(response)["rows"][0]["row"]
            if row["id"] != sample["id"] or row["speaker_id"] != sample["speaker_id"]:
                raise ValueError("Dataset row identity changed")
            download(row["audio"][0]["src"], path, sample["sha256"])
        elif sha256(path) != sample["sha256"]:
            raise ValueError(f"Fixture checksum mismatch: {path}")
        wav = path.with_suffix(".wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)], check=True)
        with wave.open(str(wav)) as stream:
            clips[sample["id"]] = array.array("h", stream.readframes(stream.getnframes()))
    silence = array.array("h", [0]) * 48000
    truth = {}
    for name, tracks in SCENES.items():
        directory = fixtures / name
        directory.mkdir(exist_ok=True)
        outputs, truth[name] = [], {}
        for track, ids in zip(["mic", "output"], tracks):
            samples, segments = silence[:], []
            for clip in ids:
                start = len(samples) / 48
                samples.extend(clips[clip])
                segments.append({"clip": clip, "speaker_id": int(clip.split("-")[0]), "start_ms": start, "end_ms": len(samples) / 48})
                samples.extend(silence)
            outputs.append(samples)
            truth[name][track] = segments
        length = max(map(len, outputs))
        for track, samples in zip(["mic", "output"], outputs):
            samples.extend(array.array("h", [0]) * (length - len(samples)))
            with wave.open(str(directory / (track + ".wav")), "wb") as stream:
                stream.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
                stream.writeframes(samples.tobytes())
    (base / "local-models.json").write_text(json.dumps(config, indent=2) + "\n")
    (fixtures / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    (fixtures / "scene-truth.json").write_text(json.dumps(truth, indent=2) + "\n")
    print(f"Prepared {len(SCENES)} scenes. Config: {base / 'local-models.json'}")
    print("Synthetic arrangement of public English read speech. No WER/DER or recognition-quality claim.")


if __name__ == "__main__":
    main()
