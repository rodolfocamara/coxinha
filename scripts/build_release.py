#!/usr/bin/env python3
"""Build the release installers with everything the app loads at runtime.

1. Fetch the speaker models (spec 0099).
2. Build the frontend and the binary, which also builds transcribe.cpp as a
   shared library when Tagarela is on (`stt-tagarela-shared`).
3. Copy those libraries into src-tauri/resources/native/, which
   `tauri.release.conf.json` ships next to the binary: the exe folder on
   Windows, usr/lib/Coxinha (the binary's runpath) on Linux.
4. Bundle with `tauri build`, which reuses the dependencies built in step 2.

Usage: python scripts/build_release.py [--platform linux|windows]
       [--features "..."] [-- extra tauri build args]
"""
import argparse
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NATIVE = ROOT / "src-tauri" / "resources" / "native"
DEFAULT_FEATURES = "local-processing stt-tagarela-shared"


def run(*args: str) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True, shell=sys.platform == "win32")


def native_libraries(platform: str) -> list[pathlib.Path]:
    """The transcribe.cpp libraries from the newest release build, if any."""
    outs = sorted(
        (ROOT / "target" / "release" / "build").glob("transcribe-cpp-sys-*/out"),
        key=lambda out: out.stat().st_mtime,
        reverse=True,
    )
    for out in outs:
        if platform == "windows":
            found = sorted({p for d in ("bin", "lib") for p in (out / d).glob("*.dll")})
        else:
            # `libX.so` points at the soname file (`libX.so.0`) the loader asks for.
            found = sorted(
                link.parent / link.readlink().name
                for link in (out / "lib").glob("lib*.so")
                if link.is_symlink()
            )
        if found:
            return found
    return []


def collect(platform: str) -> None:
    shutil.rmtree(NATIVE, ignore_errors=True)
    NATIVE.mkdir(parents=True)
    libraries = native_libraries(platform)
    for library in libraries:
        target = NATIVE / library.name
        shutil.copyfile(library, target)
        target.chmod(0o755)
        print(f"ok {library.name}")
    if not libraries:
        # The bundle glob must match something; an unused marker is harmless.
        (NATIVE / "NO_NATIVE_LIBRARIES").write_text("built without stt-tagarela-shared\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    default = "windows" if sys.platform == "win32" else "linux"
    parser.add_argument("--platform", choices=["linux", "windows"], default=default)
    parser.add_argument("--features", default=DEFAULT_FEATURES)
    parser.add_argument("tauri_args", nargs="*")
    args = parser.parse_args()
    run(sys.executable, "scripts/fetch_speech_models.py", "--platform", args.platform)
    run("pnpm", "build")  # the binary embeds dist/
    run("cargo", "build", "--release", "-p", "coxinha", "--features", args.features)
    collect(args.platform)
    run(
        "pnpm", "tauri", "build",
        "--features", args.features,
        "--config", "src-tauri/tauri.release.conf.json",
        *args.tauri_args,
    )


if __name__ == "__main__":
    main()
