#!/usr/bin/env python3
"""Fetch the speaker-separation models bundled with the installer (spec 0099).

Downloads pinned files, checks SHA-256 and writes them to
src-tauri/resources/speech/, which `tauri.release.conf.json` ships as
`speech/` next to the binary. Files already present with the right hash are
kept. Usage: python scripts/fetch_speech_models.py [--platform linux|windows]
"""
import argparse
import hashlib
import io
import pathlib
import sys
import tarfile
import urllib.request
import zipfile

HF = "https://huggingface.co"
ORT = "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0"

MODELS = [
    (
        "segmentation.onnx",
        f"{HF}/onnx-community/pyannote-segmentation-3.0/resolve/"
        "733a93b6473d019a773298e08cefa686894b1854/onnx/model.onnx",
        None,
        "057ee564753071c0b09b5b611648b50ac188d50846bff5f01e9f7bbf1591ea25",
    ),
    (
        "wespeaker.onnx",
        f"{HF}/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/"
        "f0c48c298fd835726c27956a5d617bad7115627e/voxceleb_resnet34_LM.onnx",
        None,
        "7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068",
    ),
]

# (file, archive url, member inside the archive, archive sha256, file sha256)
RUNTIME = {
    "linux": (
        "libonnxruntime.so.1.22.0",
        f"{ORT}/onnxruntime-linux-x64-1.22.0.tgz",
        "onnxruntime-linux-x64-1.22.0/lib/libonnxruntime.so.1.22.0",
        "8344d55f93d5bc5021ce342db50f62079daf39aaafb5d311a451846228be49b3",
        "3da6146e14e7b8aaec625dde11d6114c7457c87a5f93d744897da8781e35c673",
    ),
    "windows": (
        "onnxruntime.dll",
        f"{ORT}/onnxruntime-win-x64-1.22.0.zip",
        "onnxruntime-win-x64-1.22.0/lib/onnxruntime.dll",
        "174c616efc0271194488642a72f1a514e01487da4dfe84c49296d66e40ebe0da",
        "579b636403983254346a5c1d80bd28f1519cd1e284cd204f8d4ff41f8d711559",
    ),
}

OUT = pathlib.Path(__file__).resolve().parent.parent / "src-tauri" / "resources" / "speech"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, expected: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    if sha256(data) != expected:
        sys.exit(f"checksum mismatch for {url}")
    return data


def member(archive: bytes, url: str, name: str) -> bytes:
    if url.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            return z.read(name)
    with tarfile.open(fileobj=io.BytesIO(archive)) as t:
        return t.extractfile(name).read()


def write(name: str, data: bytes) -> None:
    part = OUT / f"{name}.part"
    part.write_bytes(data)
    # Installers keep the mode; a restrictive umask must not hide the files.
    part.chmod(0o644)
    part.replace(OUT / name)
    print(f"ok {name} ({len(data)} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    default = "windows" if sys.platform == "win32" else "linux"
    parser.add_argument("--platform", choices=sorted(RUNTIME), default=default)
    platform = parser.parse_args().platform
    OUT.mkdir(parents=True, exist_ok=True)
    for name, url, _, digest in MODELS:
        target = OUT / name
        if target.is_file() and sha256(target.read_bytes()) == digest:
            print(f"ok {name} (cached)")
            continue
        write(name, fetch(url, digest))
    name, url, inside, archive_digest, digest = RUNTIME[platform]
    target = OUT / name
    if target.is_file() and sha256(target.read_bytes()) == digest:
        print(f"ok {name} (cached)")
        return
    data = member(fetch(url, archive_digest), url, inside)
    if sha256(data) != digest:
        sys.exit(f"checksum mismatch for {inside}")
    write(name, data)


if __name__ == "__main__":
    main()
