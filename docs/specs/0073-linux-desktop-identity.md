# Spec 0073: Linux desktop identity

- Status: in-progress
- Phase: F1

## Scope and acceptance

Give the local validated native executable and future Linux bundles one stable
window identity, desktop entry and theme icon, using the existing orange assets.
Keep the user's running application, real profile, vault, databases, keyring and
host desktop installation untouched. Preserve the dirty product checkout.

Before implementation, reproduce the current window identity in a private
D-Bus session and virtual KWin compositor. Test GTK application-ID registration
with two concurrent private profiles before deciding whether to enable it.
The installed Tao runtime registers GtkApplication with empty flags: enabling
Tauri's GTK app ID also enables session-wide D-Bus uniqueness. Identity must not
introduce a remote-activation crash or prevent parallel private profiles.

Prefer the bundler's existing product-name desktop filename, `Coxinha.desktop`,
with matching `Coxinha` executable identity and theme icon. Keep the application
identifier `br.dev.coxinha.app` unchanged. Confirm the exact runtime behavior
before finalizing the configuration. No new art or network runtime dependency.

A new standard-library Python installer requires explicit destination and native
launcher paths. It writes only under that destination, uses no shell, quotes
Desktop Entry Exec values according to both escaping layers, handles literal
percent signs and shell metacharacters, and refuses unlike files or symlinks
before mutation. Reinstallation of the same input is idempotent. No implicit
production install, cache refresh, process launch or launcher replacement.

Tests use temporary directories and `desktop-file-validate`, with meaningful
escaping, identity, refusal and idempotence checks. Native proof must query KWin
`desktopFileName`, `resourceClass`, `resourceName` and `icon.name`, and demonstrate
that the theme lookup reaches the exact existing asset. Test two simultaneous
product processes on the same private bus. A fixture alone is not product proof.

## Validation boundary

Artifacts, copied/trimmed native harness and exact before/after SHA-256 pins live
in `target/linux-identity-20261025`. If building, copy source and existing dist,
reflink the frozen Cargo target into that isolated tree, and build offline and
locked with `local-processing,tauri/custom-protocol`. Never run backend tests or
the default executable. Runtime ORT is an explicit public library path.

Parent owns final integration and the already authorized reversible local installation. No commit,
push, spec index edit, real KWin change or claim of production acceptance.

## Sources

- Installed Tauri 2.10.3 `app.rs:2129` chooses GTK app ID only when enabled.
- Installed Tao 0.34.8 `event_loop.rs:226-230` constructs and registers
  GtkApplication with empty flags.
- [GApplication](https://docs.gtk.org/gio/class.Application.html) documents
  D-Bus process uniqueness when an application ID is supplied.
- [Desktop Entry Exec](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)
  specifies double quoting, two escape layers and literal percent handling.
- [Tauri bundler freedesktop source](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.8.1/crates/tauri-bundler/src/bundle/linux/freedesktop/mod.rs)
  uses product name for the desktop filename and main binary name for icons.

## R1 evidence, superseded for local launcher installation by R2

Local implementation validated; parent integration and host installation remain pending.

- `mainBinaryName=Coxinha` aligns the existing bundler-generated
  `Coxinha.desktop`, `Exec=Coxinha`, `StartupWMClass=Coxinha` and
  `Icon=Coxinha`. No desktop template is needed. `enableGTKAppId=false` is
  explicit; Tauri identifier remains `br.dev.coxinha.app`. This main binary
  rename also applies to other bundle targets; Windows/macOS were not executed.
- The installer creates a `coxinha/Coxinha` symlink to the explicit validated
  ELF native executable. Scripts are refused because they may discard argv[0].
  It copies existing 32/128/256 PNG assets into hicolor, and never replaces a
  differing existing entry, icon or link. Upgrades to a new launcher target
  require parent-owned backup/removal of the prior unlike link.
- Both destination and launcher are required absolute parameters. Optional
  `--ort-library` records an explicit public runtime path in Exec.
  `/usr/bin/env --` executes the quoted native link without a shell; using a
  stable first executable also avoids Gio's pre-expansion executable lookup
  rejecting literal percent signs. Controls and equals signs in destination
  executable paths are refused before any write. Launcher and ORT paths retain
  supported spaces, quotes, backslashes, percent signs and shell metacharacters.
- `python tools/test-linux-desktop.py -v`: eight passing contracts. Includes
  actual Gio launch of a temporary compiled argv/environment recorder from a
  hostile path, validator checks, unchanged-file idempotence, preflight refusal
  of unlike files/links/symlink ancestors, invalid-input and missing-library
  checks, configuration mismatch and required CLI parameters.
- `themed-before/window-icons.json`: real frozen product announces app ID
  `coxinha` and KWin supplies fallback icon `wayland`.
  `final-desktop/result.json` and `window-icons.json`: two real product processes
  launched through the staged desktop entry, same private D-Bus/compositor,
  separate HOME/XDG data/config/cache/state/vault, both ready and alive;
  resourceClass/desktopFileName/appId/iconName are `Coxinha` and iconNull=false.
  KWin's resourceName remains `coxinha`, which does not prevent association.
- Qt's JS representation of QIcon is only `QIcon()` and exposes no `name`
  property here. The copied harness therefore also reads the compositor's
  Plasma window-management protocol through KWayland, retrieving actual
  `QIcon::name()` for each product window. The native KDE theme probe resolves
  `staged-final/icons/hicolor/128x128/apps/Coxinha.png` and compares normalized
  QPixmap pixels with the original asset: `pixelsMatch=true`.
- `gtk-fixture/result.json`: with the explicit GTK app ID, the second process
  registers as remote and activates the first process instead of receiving
  local activation. This validates the uniqueness concern; it does not claim
  a product activation crash was reproduced. The chosen config avoids it.
- Tauri CLI 2.10.1 / bundler 2.8.1 generated and validated a real private debug
  Debian package using a copied frozen binary, with no Cargo invocation.
  The checkout already references missing `icons/icon.icns`, which blocks the
  unmodified bundle command. A test-only icon-list override excluded that
  absent macOS asset; the effective Linux PNG assets and product config were
  otherwise preserved. The second bundle invocation warned about already
  patched bundle-type metadata. No release/AppImage acceptance is claimed.
- Frozen product binary SHA-256 remains
  `53fcd2d6c3f0b8a16ee39da92f66ceb2d91f77c8441f37f18807705bee3eed01`.
  Brand PNG SHA-256 remains
  `f3e13ec5ef1cca5209397523de6d9b221447be154291337b83005a51f402cbbf`.
  Config before SHA-256:
  `1dd50fbd0c597d094bc00e9d88629b51332bd6a539077e858133b5fee7981597`;
  after: `5495975a24246ed4d2256d35e8f8c99c59ec17f6aed116cf7216eb2eea885ad3`.
  Full exact delta, snapshots, commands, tests and pins are in the artifact root.

Only the four owned product files changed. No backend tests, root build/dist,
real app, user data, keyring, host desktop entries or OS settings were changed.
The frozen native binary proves the filename/desktop/theme mechanism; the
parent must integrate the config with its final frontend/backend snapshot and
install within the already authorized reversible local scope. Direct `cargo build` still emits the
Cargo package name; use Tauri CLI packaging or the installer for stable identity.


## R2 contract, written before implementation

R1 validated native identity but its ELF-only entry bypassed the actual validated
launch-demo -> launch-session-workspace.py chain. It must not be installed for
the local demo profile. Preserve the complete existing launcher environment,
checksum, pre-migration backup, process guard and inherited lifetime flock.

Add an explicit wrapper mode to the installer. Desktop Exec must invoke the
original absolute wrapper path directly, including explicit argument boundaries.
Do not put a script behind a differently located symlink: launch-demo derives
its profile root from BASH_SOURCE. Do not override wrapper-owned profile/ORT
settings. Preserve native ELF mode for callers that intentionally need it.

The parent will make the minimal final script change after integrating its
candidate: retain the execv executable path and held inheritable lock, change
only argv[0] to Coxinha. Checksum updates remain tied to the final binary. The
installer does not edit or execute that live launcher.

Before declaring success, copy both launchers into a staging fixture with only
synthetic profile contents. Test checksum refusal, complete backup receipts,
argument forwarding and lifetime lock exclusion after exec. Launch the real
frozen native product through this copied wrapper, in private KWin/D-Bus/HOME,
and verify resource class, desktop filename, actual protocol icon name and
exact wrapper-selected XDG/vault paths. No real databases, current process,
launcher or host desktop changes. R1 artifacts and pins remain immutable; R2
before/after snapshots, delta, input pins and proof live in the r2 artifact.

Local installation by the parent is already authorized. Integration with the
final candidate is a sequencing requirement, with no additional approval gate.


## R2 validation and integration

- Installer wrapper mode invokes the original absolute script directly, with
  individually quoted `--launcher-arg` values. It creates no native alias and
  does not set HOME, XDG, vault or ORT. `--ort-library` is refused in wrapper
  mode because the wrapper owns it. Native mode is retained as an explicit
  alternative for an ELF caller without the demo profile contract.
- Ten tests pass, including the original native-mode contracts plus real Gio
  wrapper launch with hostile paths/arguments, environment mapping, lifetime
  inherited flock, duplicate-launch refusal, synthetic backup and checksum
  refusal. The fixture derives its root from BASH_SOURCE, so relocating it
  behind an installer symlink would fail the profile assertions.
- `r2/native-wrapper` launched two real frozen products through copied
  launch-demo -> launch-session-workspace.py -> execv. Only argv[0] changed in
  each copied Python launcher. Their actual executable paths and SHA-256 still
  identify the original frozen binary. The original launchers were only read;
  their before/after hashes match `r2/readonly-input-pins.json`.
- KWin resourceClass and desktopFileName, native Plasma protocol appId and
  iconName all equal Coxinha; both icons are non-null. The native KDE lookup
  matches the exact brand pixels. `/proc` observations of only the two private
  product PIDs confirm argv[0]=Coxinha, literal forwarded arguments and all four
  wrapper-owned XDG/vault paths. The public ORT path is preserved.
- `wrapper-contracts.json` proves the inherited launcher flock is held during
  each native product lifetime, duplicate launch exits 1, and the complete
  pre-migration backup includes synthetic data/vault/config but not cache.
  `post-native-contracts.json` proves lock release after exit, backup receipt
  idempotence and checksum mismatch refusal using the copied actual launcher.
- R2 before/after snapshots, exact patch and SHA-256 pins are separate from
  immutable R1 evidence. No Cargo invocation, host desktop install, live
  launcher edit, lifecycle/locale change or real profile/DB/keyring access.

After integrating its final binary, the parent updates the existing launcher's
BINARY/EXPECTED_SHA256 pins as required for that candidate, and applies only the
identity change in `r2/launcher-integration.patch`:

```python
os.execv(str(root / BINARY), ["Coxinha", *sys.argv[1:]])
```

Keep prepare(), os.set_inheritable(), launch-demo and its environment unchanged.
Then the recommended already-authorized local installation command is:

```sh
python tools/install-linux-desktop.py --destination "$HOME/.local/share" \
  --launcher /home/rcamara/Repos/coxinha/target/recognition-validation-20261023/launch-demo \
  --launcher-mode wrapper
```

This creates the host entry/icons only when the parent executes it. It does not
launch or restart the product. The desktop destination is not an application
profile override: data remains under the launch-demo directory's desktop-data,
vault under desktop-vault, config under desktop-config, cache under
desktop-cache. Tauri's br.dev.coxinha.app subdirectory stays unchanged inside
XDG_DATA_HOME. No additional approval gate is introduced.
