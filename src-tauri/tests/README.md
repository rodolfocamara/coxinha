# Native test isolation

Default `cargo test` does not discover boot_smoke, perf_smoke or shortcut_smoke.
They require the non-default `native-smoke-tests` feature and are also ignored,
including with `--all-features`. `perf_new_note` is a hermetic Storage benchmark:
it never spawns an application and keeps its 50 ms threshold.

Only the parent/operator may run native tests, after provisioning a private OS
user desktop/session with a private display, session bus and hotkey namespace.
Do not acknowledge a shared operator session. On Windows, use a separate logged
in test user/session; XDG environment variables do not isolate Windows appdata.
On Linux, provision a dedicated desktop/display/session bus; do not point at the
operator's XAUTHORITY, DISPLAY, Wayland socket or session bus. Acknowledgment is
an operator gate, not an automatic proof of desktop isolation.

For an authorized private session, set `COXINHA_NATIVE_PRIVATE_SESSION=1`, then
run each target individually with `--features native-smoke-tests --test <name>
-- --ignored --exact <test_name>`. Use `--offline --locked` and a private
CARGO_TARGET_DIR. Do not run all ignored tests: other ignored tests are internal
crash fixtures. No performance budget was changed. The prior 236.7 MB > 200 MB
measurement remains unresolved and requires a new parent-owned native baseline.

The harness creates a fresh, uniquely named TempDir and ownership marker, clears
inherited application environment, and sets private home, appdata, config, cache,
state and temp roots. An explicit validated app profile redirects the vault and
its config/index, canonical library, desktop logs and webview data. The calendar
cache also uses the validated profile's app-data/outlook-cache.json, and its
path-derived credential installation key is therefore in a separate namespace.
Profile calendar resolution never consults OS app-data known-folder APIs. Pure
resolver/key tests use explicit inputs and never construct an OS keyring entry
or access credentials/OAuth. Webviews use
an ephemeral store as well (including WKWebView). Invalid/incomplete profiles
fail closed before startup; there is no fallback to an operator default. The
profile is supported only by builds with the explicit native-smoke-tests feature.
Production defaults remain unchanged. The child owner kills and reaps on every
Rust unwind/return before TempDir removal. Abrupt test-runner termination cannot
run destructors; the disposable profile must never contain real data.

`native_harness_contract` only constructs commands and tests path resolution.
It does not launch a native process. `cargo test --test native_harness_contract`
and `cargo test --tests -- --list` are safe hermetic contract/discovery checks.
Feature-enabled `--list` verifies ignored target discovery without invoking them.
