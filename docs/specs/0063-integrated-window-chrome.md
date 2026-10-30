# Spec 0063: Integrated window chrome

- **Status:** in-progress
- **Phase:** F1

## Intent

Use the existing themed ChromeCap as the single desktop title bar, removing the
separate OS decoration. Keep browser previews usable without native controls.

## Contract

- The main Tauri window is undecorated and remains resizable.
- ChromeCap retains navigation context and action slots. Spec 0065 presents a
  single page once and preserves real multiple open tabs.
- Only explicit blank flexible regions in the content and brand headers start
  native dragging through one shared WindowChrome provider; double-clicking
  that region toggles maximization. Interactive content never starts dragging.
- Accessible, translated minimize, maximize/restore and close buttons use the
  current Tauri window API. Close calls `close()` so ADR-0019 confirmation and
  pending-save handling retain ownership of exit.
- Maximization state refreshes on native resize, including OS-driven changes.
  Async listener registration is cleaned up even after unmount.
- Failed native operations show a translated accessible error and permit retry.
- Existing background/foreground theme tokens apply in light and dark mode.

## Acceptance and validation

Unit tests cover browser fallback, native actions, drag versus interactive
content, double-click, maximize state and asynchronous listener cleanup/errors.
Run focused Vitest and TypeScript checks. Linux/Windows compositor behavior,
resize edges and native save confirmation require desktop smoke acceptance.

## Implementation evidence

- Focused Vitest: WindowChrome, DesktopLifecycle and nativeTheme, passed.
- `pnpm typecheck` passed.
- Installed `tauri-runtime-wry` 2.10.1 `src/lib.rs` attaches its
  `undecorated_resizing` handler to the GTK webview and to undecorated resizable
  Windows windows. Keep native resize behavior rather than adding an overlay.
- Desktop compositor and Windows hardware acceptance remain pending.

## Follow-up: spec 0066

The installed native handler exists, but source inspection did not establish a
usable resize target or resolve competition with header dragging. Parent-native
KWin Wayland probes on 2026-10-24 found seven working directions at 3px while
North moved the window, and no resize in any direction at 8px. Spec 0066 adds
perimeter targets, directional cursors and state/dispatch guards while retaining
the native outer band. Native acceptance of that change remains separate.
