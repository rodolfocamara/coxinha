# Spec 0067: Rounded native window

- **Status:** in-progress
- **Phase:** F1
- **Depends on:** [0066](./0066-desktop-window-contract.md)

## Intent and scope

Round all four outer corners of the restored native window, following the
user-selected T3 Code reference. Actual alpha reveals the desktop in the cutouts;
the rest of the application remains opaque. No acrylic, vibrancy, new dependency,
launcher or user-data change. Specs 0068/0069 and note storage are outside this task.

## Acceptance contract

- The main Tauri window combines `transparent: true` with
  `backgroundColor: [0,0,0,0]`. Native HTML, body and root remain transparent from
  the inline first paint through subsequent theme updates.
- The restored frame uses the existing `--radius-md` token (10px), its opaque
  `bg-background`, and the existing 10px gutter. The same restored-state decision
  controls one rounded clip at the entire body viewport boundary. It includes
  fixed descendants, portals into body, CommandPalette, NoteActionsMenu and the
  DesktopLifecycle saving overlay outside the routed WindowFrame.
- Do not add containment, transforms or per-menu clipping that changes fixed
  positioning or clips dropdowns to their inner layout containers.
- Known maximized/fullscreen states have radius/gutter zero, no viewport clip and
  no DOM handles. Restore recovers rounding and all eight handles using the
  existing shared subscription. Add no native listener, IPC or permission.
- Initial pending/failed native queries keep the restored layout and clip while
  withholding active resize handles. A layout effect updates the viewport marker
  before paint, and its owner cleanup removes it on route/provider unmount.
  Overlapping owner cleanup must not erase another mounted frame's decision.
- Radius 10 includes the existing logical native hit at (3,3): sqrt(98) < 10.
  Preserve eight handles/cursors, Linux `5 * scaleFactor` exclusion, DOM resize
  elsewhere, header drag, menu geometry and explicit close/save ownership.
- Browser preview stays opaque and square, without native clipping/gutter/handles.
  Theme preferences and live changes must not refill native cutouts.

## Design and sources

- Product changes are limited to Tauri transparency, document first paint and
  WindowFrame geometry/viewport ownership. Do not change the resize hook,
  DesktopLifecycle, App, Rust or capabilities.
- [Tauri configuration](https://v2.tauri.app/reference/config/#windowconfig)
  defines window/webview background and transparency. Windows ignores alpha on
  the window background alone, so `transparent` is also required.
- Installed Tauri 2.10.3 / runtime-wry 2.10.1 / Tao 0.34.8 / Wry 0.55.1:
  Tao Linux `window.rs:136-149` selects RGBA/app-paintable; Wry
  `webkitgtk/mod.rs:289-290` forces alpha zero for transparent webviews. The
  runtime's `undecorated_resizing.rs:540-589` retains the native GTK border handler.
- First paint uses `window.isTauri`, the installed JS API's native marker, without
  `withGlobalTauri`. No simulated desktop colors.
- [CSS Masking](https://www.w3.org/TR/css-masking-1/#clipping-paths) defines clipping
  of an element and its descendants. Clip body once at the native viewport edge;
  frame overflow/border-radius alone cannot contain viewport-fixed descendants.
- [React useLayoutEffect](https://react.dev/reference/react/useLayoutEffect)
  guarantees updates before repaint. Ownership is scoped to mounted frames;
  the native first-paint marker is independent and remains intact on cleanup.
- macOS acceptance is outside this task. This pinned runtime requires
  macos-private-api for transparency there; private APIs remain disabled.

## Review findings and evidence

R1 implementation: 13 new corner contracts, 106 passing focused tests, typecheck
and changed-file Prettier passed. Against an isolated original baseline, 11 of
13 new contracts failed. Initial 14 resize R2 pins matched; only WindowFrame and
Tauri config changed in that reviewed set.

The parent proved R1 restored alpha 0 at all four corners, maximized alpha 255,
eight native directions at both 3px and 8px and the existing controls. Fable R1
then found two medium visual gaps: fixed overlays can escape frame clipping, and
DesktopLifecycle's overlay is outside the frame entirely. The parent reproduced
the actual Ctrl+K palette in WebKitGTK: all four corner alpha values become 26.
See `target/rounded-window-20261024/native/baseline-overlay-palette.png`.
This native evidence is parent-owned, not executed by this implementation agent.

R2 must reproduce the two escaping-overlay contracts before the fix and pass
with the real browser compositor after it. Include in-frame fixed content,
actual palette/menu, body portals and the actual external saving overlay;
exercise max/full/restored, preview, route/provider cleanup and remount.
Keep focused resize/chrome/menu/theme/exit tests, typecheck and Prettier.

## Artifacts and remaining gates

R1 baseline and frozen implementation are under `baseline/` and `implementation/`
inside `target/rounded-window-20261024/`. R2 baseline, source snapshot, patch and
SHA-256 pins are under `implementation-r2/` in the same directory. The R2 delta
must apply directly to the frozen R1 source, so the parent can integrate it with
its 421-file native source snapshot without unrelated concurrent note changes.

No Cargo, build, dist, native app, launcher, userdata, commit or push here.
The parent owns native R2 palette alpha, resize/control regression and integration;
Windows and mixed-DPI acceptance remain separate. This spec stays in-progress
until those native gates are established.

### R2 implementation evidence

- Before the product fix: six new viewport ownership unit contracts failed and
  the previous 13 corner tests passed. Real Chromium failed five of 11 browser
  contracts, including the actual in-frame palette, a body portal and the actual
  external DesktopLifecycle saving overlay. Their corner alpha values were
  respectively 206, 255 and 128; browser rendering differs from native GTK.
- After the fix: 125 tests passed in 13 focused files, including 19 corner and
  ownership contracts. All 11 Chromium browser contracts passed. Palette, body
  portal and saving overlay each produce four zero-alpha corners and alpha 255
  at (3,3). Maximized/fullscreen corners remain alpha 255.
- The actual fixed NoteActionsMenu keeps viewport coordinates and remains hit
  testable beyond an inner overflow container. Browser preview stays opaque;
  unmount/remount and overlapping-owner cleanup have regression coverage.
- Application typecheck, fixture typecheck and changed-file Prettier passed.
  The test's token read resolves from its module rather than the process cwd.
- These are browser/React proofs with synthetic IPC and a disposable pending
  save participant. R2 native palette alpha and integration remain parent gates.

### R3 Linux resize margin outside the surface (2026-10-29)

Field report on KDE Plasma 6 Wayland (scale 1): the resize band was hard to find.
It sat inside the visible window, in the same colour as the content and without
a shadow, while KWin windows can be grabbed just outside their visible edge.

- On Linux, while the restored gutter applies, `WindowFrame` paints the gutter
  transparent (`data-resize-outside="true"`) and renders the workspace on an
  always-mounted `window-surface` with the 10px radius, a hairline border and a
  drop shadow that fits the gutter. The eight hit regions remain siblings of the
  surface, so they cover only the transparent margin. The resize geometry is
  unchanged: native GTK keeps the outer `5 * scaleFactor`, DOM handles the rest.
- Maximized/fullscreen behaviour is unchanged: no margin, no radius, no shadow.
  The surface wrapper stays mounted across every state, so maximize/restore does
  not remount the workspace.
- Windows keeps the opaque rounded gutter of R1/R2, because Win32 resolves its
  border hits natively first; transparent-pixel hit testing there is unverified.
- Known trade-off: the body clip is still at the window boundary. A full-viewport
  overlay or backdrop covers the transparent margin while it is open. Moving the
  clip to the surface would also clip the margin's hit regions.
- Tests: `WindowCorners.test.tsx` covers the Linux margin, maximize without
  remount and the unchanged Windows frame. Native acceptance on KWin is manual.
