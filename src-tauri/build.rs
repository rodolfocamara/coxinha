fn main() {
    let revision = std::process::Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .unwrap_or_else(|| "source".into());
    let built = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("build clock")
        .as_secs();
    println!(
        "cargo:rustc-env=COXINHA_BUILD_ID={}-{}",
        revision.trim(),
        built
    );
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=locales");
    println!("cargo:rerun-if-changed=../dist");
    let linux = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux");
    if linux && std::env::var_os("CARGO_FEATURE_STT_TAGARELA_SHARED").is_some() {
        // whisper-rs links its own ggml statically: never export it, so the
        // shared libtranscribe binds to the libggml it was built with.
        println!("cargo:rustc-link-arg-bins=-Wl,--exclude-libs,ALL");
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,$ORIGIN:$ORIGIN/../lib/Coxinha");
    }
    tauri_build::build()
}
