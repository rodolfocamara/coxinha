# Spec 0066: Desktop window contract

- **Status:** in-progress
- **Phase:** F1
- **Depends on:** [0063](./0063-integrated-window-chrome.md), [0064](./0064-collapsible-workspace-sidebar.md), [0065](./0065-dash-navigation-and-sana-content.md)

## Intent and scope

Make the undecorated main window explicitly resizable on Linux Wayland and
Windows. Preserve the current dirty checkout, user data, existing shell design,
and ADR-0019 exit ownership. No launcher changes, native window launch, Cargo
build, commit, push or deployment in this implementation task.

## Contract

- Configure `resizable: true` explicitly; retain minimum logical size 800 x 600.
- Provide eight perimeter hit regions with direction-specific resize cursors.
  Reserve a 10px perimeter gutter with 24px L-shaped corners so controls, scrollbars and the board do not
  compete with the resize handles. Keep this gutter while initial native queries
  or subscriptions are pending or failed; only the active resize regions depend
  on readiness. Browser previews and known maximized/fullscreen states have no
  native gutter.
- Left mouse down in the added inner band delegates to Tauri
  `startResizeDragging` with the matching direction after checking native state.
  On Linux the outer 5px remain native-only and the queried native scale extends
  that exclusion to `5 * scaleFactor`, matching runtime-wry GTK; at scale 2 or
  above the runtime owns the entire gutter. On Windows every press delivered to
  a resize region in the DOM delegates to JS, including the outermost pixels:
  Win32 consumes its own native border hits before they reach the DOM. No manual geometry loop or document-wide pointer capture.
- Hide resize regions while maximized or fullscreen and recheck native state
  before dispatch, including state changes initiated by the operating system.
- Native action and subscription errors remain accessible and translated, with
  retry through the same controls. Keep one shared native resize subscription.
- Blank-header dragging and double-click maximize/restore continue to work;
  interactive children never initiate dragging.
- Minimize and maximize/restore remain keyboard-reachable standard buttons.
  OS shortcuts (including Alt+F4) remain owned by the OS; no global interception
  or conflicting application shortcuts are added.
- Close uses `close()` and native CloseRequested prevention, confirmation,
  pending-save flush and recording shutdown. Never use destroy or process exit
  from the chrome. Restoring/showing the main window retains unminimize/focus.

## Validation and limits

Focused tests must fail before and pass after for perimeter resize, state
suppression, direction dispatch, IPC errors, keyboard button activation and
close lifecycle regressions. Run focused frontend tests, typecheck and Prettier.
The parent owns full suite, build, browser checks and isolated native compositor
acceptance on Linux/Windows. A passing mock proves dispatch and guards, not that
a Wayland compositor accepts a serial after asynchronous IPC/state queries.

### Source and native evidence

- `Cargo.lock` pins Tauri 2.10.3, runtime-wry 2.10.1 and Tao 0.34.8.
- Installed `tauri-runtime-wry-2.10.1/src/undecorated_resizing.rs:535-589`
  attaches a GTK button handler, checks decorated/resizable/maximized state,
  calculates `window.scale_factor() * 5` against GDK coordinates and returns
  `Propagation::Proceed`. It does not establish frontend cursor feedback or
  prevent subsequent JS header dragging. This is source evidence, not a claim
  that all native resizing is broken.
- Installed `tao-0.34.8/src/platform_impl/linux/event_loop.rs:337-350` forwards
  explicit resize to GTK using the current seat pointer and `GDK_CURRENT_TIME`.
  The frontend API adds async IPC and state/scale queries. Only native tests can
  establish compositor acceptance of the press/serial and resulting geometry.
- [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
  defines `startResizeDragging(direction)`; its explicit permission is added
  only to the existing main-window capability. `scaleFactor`, fullscreen and
  maximized queries are already in the existing core default permission set.
- Parent-native isolated KWin Wayland scale-1 evidence:
  `target/desktop-contract-20261024/native/baseline-inset3.json` reports resize
  in seven directions; North moves instead. `baseline-inset8.json` reports
  no resize in all eight directions and North movement. The 3px East probe
  increased width from 1200 to 1300. These prove an actual North interaction
  conflict plus insufficient reach at 8px, not complete native resize failure.
- The frame targets are siblings of the content/header, so a 3px North press
  cannot bubble through the header drag handler. At 8px the explicit North
  resize action owns the press. JS tests cover both boundaries; the parent
  must prove the same native gestures after rebuilding.

### Implementation and remaining gates

This inventory records the implementation-stage gates. The R2 section below
records subsequent parent-reported R1 acceptance without claiming R2 native
acceptance.

| Behavior                                                      | Current status                    | Evidence / remaining gate                                                                                                      |
| ------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Explicit resizable/minimum 800 x 600                          | Implemented                       | Config contract test; native minimum-size acceptance pending                                                                   |
| Eight directions / directional cursors / North precedence     | Implemented                       | JS dispatch, native-band exclusion and structure tests; after-build native/browser acceptance pending                          |
| No content/scrollbar/board overlay                            | Implemented                       | Reserved gutter and clipped L-shaped corners; real browser hit testing pending                                                 |
| Maximized/fullscreen suppression                              | Implemented in frontend           | Hidden handles, fresh native state guard and stale-result cancellation; OS/native handlers need compositor acceptance          |
| Linux scaled native-band exclusion                            | Implemented                       | Scale-2 mock verifies no explicit dispatch at 8px, then scale-1 dispatch; native mixed-DPI acceptance pending                  |
| Error/retry and i18n/a11y                                     | Implemented                       | English/Portuguese alerts, no raw IPC text, focusable retry; retry re-registers a failed listener                              |
| Drag/double-click / minimize/maximize/restore / close         | Preserved                         | Focused regression and keyboard button activation tests                                                                        |
| Close/Alt+F4 confirmation/save                                | Existing lifecycle preserved      | Source contract plus frontend flush/save/abort tests; real native dialog/save acceptance pending                               |
| Restore/minimize/focus                                        | Ordering corrected                | `show -> unminimize -> set_focus`; source assertion only, OS focus policy acceptance pending                                   |
| Windows resize / shortcuts / DPI                              | Pending native Windows acceptance | Linux evidence cannot establish Windows behavior                                                                               |
| Persisted geometry / multi-monitor recovery / single instance | Gaps, deferred                    | No geometry persistence or single-instance ownership added; mixed-scale placement requires native hardware and recovery policy |

The Linux-specific exclusion uses the current default WebKitGTK user agent
(`Linux`) to avoid adding a platform plugin. No user-agent override is configured.
An application override or future runtime change requires revisiting that check.
The Windows native border follows system metrics and consumes its own events,
so neither Linux's early 5px exclusion nor its scaled GTK formula is applied
there. A fixed exclusion can leave a dead strip beyond a narrower Win32 frame;
Windows DOM presses at 4.5px have regression coverage, but native Windows
acceptance remains pending.

### Keyboard and fallback contract

- Tab reaches the existing minimize, maximize/restore and close buttons; Enter
  and Space activate them. Retry is also focusable and keyboard-activated.
- Native keyboard resize/move and OS window menus remain compositor-owned.
  Their configured shortcuts and undecorated-window behavior require separate
  Linux/Windows native checks. No portable in-app keyboard geometry editor or
  global resize shortcut was introduced, so do not claim that as implemented.
- The original outer native band remains available if explicit inner-band IPC
  fails. The translated alert exposes retry. This is a fallback path, not proof
  of successful geometry change, especially for the known baseline North bug.
- Close always requests the existing confirmation/save lifecycle. Native
  minimize keeps the process alive. Restoring asks for focus after unminimize;
  the compositor may still control focus-stealing policy.

### Executed frontend validation

- `pnpm exec vitest run` on WindowResize, WindowChrome, desktopContract,
  AppShell.sidebar, ChromeCap, DesktopLifecycle, lifecycle, nativeTheme and
  locale tests: **63 passed in 9 files**.
- Resize contract before implementation: **18 failed** (no perimeter support).
  Explicit-resizable, permission and restore-order source contracts: **3 failed**.
  The later native-band/gutter regression had **2 failed / 20 passed** before
  the 10px extension and outer-band guard. Logs are in
  `target/desktop-contract-20261024/implementation/`.
- Existing close/save lifecycle tests passed before and after; no artificial
  lifecycle failure is claimed. No custom keyboard actions were added.
- `pnpm typecheck` passed. Prettier is checked only on files changed by this task.
- No Cargo build, native launch, launcher update or user-data mutation performed
  here. Full suite/build/browser/native checks belong to the parent; this spec
  remains in-progress.

## Desktop inventory and deferred scope

- Current: custom title bar, minimum size, drag, maximize/restore, minimize,
  explicit tray restore/show/focus and confirmation/save exit lifecycle.
- In this change: explicit resizability, eight-direction perimeter interaction,
  state guards, permission and focused regression coverage.
- Deferred: persisted geometry (requires storage and recovery policy),
  multi-monitor/high-DPI placement (requires native mixed-scale hardware
  acceptance), single-instance behavior (requires process/startup ownership).
  Do not claim these behaviors from the resize API or browser tests.

## R2 review follow-up

Fable R1 was reported approvable by the parent with two bounded corrections:

- Restrict the frame's early outer-5px exclusion to Linux. The hook's existing
  Linux-only `5 * scaleFactor` check remains unchanged. Windows native hit
  testing can consume a 4px system frame before DOM dispatch, so JS must handle
  DOM-delivered presses at 4.5px rather than silently returning.
- Separate layout from resize readiness. `native && !maximized && !fullscreen`
  owns the gutter; `resizable` owns active hit regions. Initial query/listener
  failures keep content and header dragging outside the 10px perimeter, expose
  the existing translated retry and render no active handles. Retrying restores
  handles without a 0-to-10px layout jump. No new hook state or permission is
  needed.

The parent explicitly retained the 10px gutter after visual inspection. This is
an accepted layout decision, not a new user question. Mac support and geometry
persistence remain out of scope; no process ownership or launcher behavior was
changed. Windows, native mixed-DPI and compositor shortcut limits above still
apply.

Parent-reported R1 acceptance, for the frozen `review-r1` snapshot:

- Isolated KWin Wayland: eight of eight directions resized at both 3px and 8px;
  minimum 800 x 600, maximize/restore, minimize and close confirmation/cancel
  passed. This supersedes pending R1 gates for those specific gestures only.
- Browser: cursors and controls passed in both themes at 800px and 1200px.
- Full validation: 242 frontend tests and 117 Rust tests passed. These checks
  were performed by the parent, not by this implementation sub-agent.

R2 validation executed here: the new/strengthened regression tests produced
**5 failed / 25 passed** on the frozen R1 code, then the focused nine-file set
passed **66 tests** after the correction. Typecheck and changed-file Prettier
checks passed. Logs, a SHA-256 source pin and the exact delta from R1 are under
`target/desktop-contract-20261024/implementation-r2/`. Parent full checks,
build/browser/native acceptance of R2 remain pending. No Cargo command, build,
native launch or launcher update was performed in this R2 implementation.
