# Desktop window contract audit

## Finding and correction

The previous undecorated build depended on runtime-wry's implicit resize border. On an isolated native KWin Wayland session, seven directions resized when pressed 3px inside the edge, but the north edge moved the window instead. At 8px, no direction resized. The GTK resize handler returns `Propagation::Proceed`; the old header drag handler then starts a move over the same north-edge gesture.

The fix isolates the window perimeter from header/content interaction, reserves a 10px gutter, adds eight directional hit regions and cursors, and delegates the inner extension to Tauri's native resize API. The outer native border is retained, accounting for GTK's scaled inset. The configuration explicitly permits resizing. Maximized/fullscreen windows suppress the handles; action failures expose translated retry controls. Restore/show now unminimizes before requesting focus. Close still follows the existing save/recording confirmation lifecycle.

Implementation: Sol 6.1. Independent Fable R2 review approved the bounded frontend delta. Final source snapshot: `target/desktop-contract-20261024/review-r2/`; installed source, asset, binary and launcher hashes: `target/desktop-contract-20261024/installed-manifest.json`.

## Inventory

| Desktop behavior | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Eight resize directions | Native Wayland passes at both 3px and 8px after correction; north failed before | Physical user session and Windows |
| Resize cursor and usable hit area | Browser hit testing verifies eight cursors and no content interception | Physical pointer feedback |
| Move from header/brand | Existing dispatch tests preserved; perimeter no longer invokes header drag | Native drag/snap across monitors |
| Maximize/restore | Native Wayland control buttons pass | Windows shell integration |
| No resize when maximized | Native Wayland and hook tests pass | Fullscreen suppression is covered by mocks, not native fullscreen acceptance |
| Minimum 800x600 logical size | Native shrink gesture clamps to minimum | Small screens and mixed DPI |
| Minimize | Native Wayland button passes | Windows taskbar |
| Return from minimized | Native restore through compositor passes; show helper now orders show/unminimize/focus | Real tray/shortcut restore still separate |
| Close confirmation and cancel | Native close button opens dialog; Escape keeps app alive | Real pending recording/save flow; OS Alt+F4 |
| Save failure/recovery | Existing frontend and Rust lifecycle regression suites pass | Disk/device failure in real use |
| Keyboard controls/focus | Browser Enter on minimize/close and focused unit tests pass | OS-level shortcuts and screen reader |
| Theme, navigation and collapsed sidebar | Existing complete frontend suite retained | Native OS theme propagation |
| Remember geometry after restart | Not implemented | Follow-up implementation, including corrupted state and missing monitor recovery |
| Single-instance launch | Not implemented | Follow-up implementation with isolated installation/vault scope |
| Mixed-monitor scaling and snap | Not claimed | Native platform acceptance |

## Executed checks

- Complete final frontend suite: 245 tests in 42 files passed. An earlier run exposed an inconsistent capture test fixture: status polling returned idle after start. The fixture now maintains capture state and deterministically advances a 250ms poll before stop. The old mock failed that reproduction; the corrected fixture and full suite pass. Product capture logic was unchanged.
- Rust library suite with local-processing: 117 tests passed using the installed `ORT_DYLIB_PATH`. The first run lacked that environment variable and four ONNX tests failed to locate the runtime; no code change was needed.
- Frontend production build and native local-processing build passed.
- Browser audit: real React components with synthetic IPC, dark/light, 800/1200px, eight perimeter hit tests/cursors, maximize suppression, control keyboard activation and no page errors.
- Native proof: real packaged binary, KWin Wayland virtual output, private D-Bus/runtime directories, disposable vault. Eight-direction matrix at 3px and 8px; minimum size, maximize, maximized resize rejection, restore, minimize, restore through compositor, close confirmation and cancel passed. The tested app is terminated only for isolated harness cleanup; that termination is not counted as production exit success.

The user desktop was not manipulated. No user vault, tenant or external service was touched. Windows, physical mouse acceptance, mixed monitors and genuine active-recording shutdown are separate gates. The app is not declared fully desktop-complete while the inventory has open items.

## References and reproducibility

- [Tauri window customization](https://v2.tauri.app/learn/window-customization/)
- [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
- [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/)

See `target/desktop-contract-20261024/native/README.md` for native commands, test protocol provenance, baseline/candidate results and limitations. Browser script and screenshots are in the parent validation directory.

## Independent review R1

Fable approved the bounded change, independently verified 14 source hashes, ran 47 focused tests plus 8 lifecycle tests, typechecked, checked formatting and demonstrated that five adversarial mutations are caught by the tests. Two small findings were subsequently fixed in R2: the fixed 5px exclusion leaves a 1px Windows gap, and removing the gutter on an initial state-query/subscription failure restores the old north-edge conflict.

The 10px gutter is retained as an implementation decision: the 800/1200px browser screenshots show reachable controls and readable content. R2 makes its presence independent of IPC readiness to avoid a startup layout jump. It still disappears when the window is maximized/fullscreen.

An exploratory virtual-compositor scale=2 run used incorrect hardcoded control coordinates after maximization; that restore assertion was a harness failure, not a product finding. The corrected harness reads the actual maximized geometry. This experiment is not accepted as physical mixed-DPI evidence.

## Final R2 validation and local installation

Fable independently verified all 14 R2 source hashes, ran 59 AppShell tests and the full 245-test frontend suite in an isolated copy, and proved the five R2 regression assertions fail against R1. No blocking finding remained in the reviewed delta. The root reran the full suite after the test-fixture correction: 245 passed. The 14 reviewed files remained byte-identical.

The rebuilt R2 binary passed native KWin Wayland resize in all eight directions at both 3px and 8px. Minimum size, maximize, rejection of resize while maximized, restore, minimize, compositor restoration, close confirmation and cancel passed. Evidence: `native/candidate-r2-inset3.json` and `native/candidate-r2-inset8.json`. The final browser audit passed dark/light at 800/1200px with zero page errors; the 800px screenshot was visually inspected.

`target/recognition-validation-20261023/launch-demo` now selects `coxinha-desktop-window-v2`, SHA-256 `b8e87bbe0cfcdf351a2dbfc6f74b39aaf4503ea3bc9f6ee2ea533fc3db965516`. The previous launcher is preserved as `launch-demo.before-desktop-window-20261024`; the previous binary and all data/config/vault directories remain unchanged. Launcher shell syntax and copied binary checksum were verified. The root did not launch or terminate the user's existing instance.

Physical desktop acceptance, Windows, real mixed-DPI monitors, geometry persistence and single-instance ownership remain open as listed above. This local correction is available for testing; it is not a claim that the entire desktop backlog is complete.
