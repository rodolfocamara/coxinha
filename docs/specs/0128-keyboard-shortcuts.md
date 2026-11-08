# 0128 — One keyboard shortcut system

Status: done
Phase: F1
Date: 2026-11-04

## Why

Delete never reached an item on the board, because React Flow prevents every
key it watches and the item shortcut yields to a handled key. Unit tests stub
React Flow, so nothing noticed. Pressing every shortcut in a real browser then
found two more: the note menu advertised Ctrl+L and Ctrl+D with no handler
behind them. Both are fixed, and `pnpm test:shortcuts` now covers them.

Those are symptoms of having no system:

- Nine separate `window` keydown listeners follow four different guard rules.
  Some skip text fields, some skip handled keys, some skip neither.
- Escape has about ten handlers and no order, so which layer closes depends on
  who registered first.
- Shortcuts are plain strings in several places. `Ctrl+Alt+W` is hardcoded in a
  locale although it is configurable, the note menu's hints say Ctrl on a Mac,
  and the Mac is detected in three ways.
- Five components each implement arrow-key list navigation.
- Nobody can discover them. Settings lists only the five global ones, and those
  cannot be changed yet.
- The calendar has no keyboard navigation.
- Deleting from the side editor or the palette asked through `window.confirm`,
  which does nothing in this app (below).

## `window.confirm` never asked

`tauri-plugin-dialog` injects a script that replaces `window.confirm` with an
`async function`, on every desktop platform. `if (!window.confirm(...)) return`
therefore tests a Promise, which is always truthy, and the delete ran with the
answer never read. Version 2.7.0, the one in `Cargo.lock`, does not even register
the `plugin:dialog|confirm` command it calls, so no dialog opens at all.

Checked in WebKitGTK 2.54.2, offscreen, with the same guard:

| `window.confirm` | Returns | Dialog signals | The delete |
|---|---|---|---|
| Native, the user declines | Boolean | 2 | Stopped |
| With the plugin's script | Promise | 0 | Ran |

Both call sites now move the note to the trash at once and offer the undo the
board has: the side editor uses the board's, so the card returns too, and the
palette and the standalone note use `TrashUndoBar`. The note was always recoverable
from `.coxinha/trash/`. `contract.test.ts` rejects `window.confirm`, `alert` and
`prompt` anywhere under `src/`.

## Inventory (2026-11-04)

| Scope | Keys | Action | State |
|---|---|---|---|
| System | Ctrl+Alt+Y | New note | registered |
| System | Ctrl+Alt+O | Open the app | registered |
| System | Ctrl+Alt+G | Agenda | registered |
| System | Ctrl+Alt+T | Meetings | registered, but the owner's KDE gives it to a terminal; Settings now names it |
| System | Ctrl+Alt+W | Start or stop recording | registered |
| App | Ctrl+K, Ctrl+P | Palette | tested |
| Palette | Up, Down, Enter, Esc | Move, open, close | Esc tested |
| Palette | Ctrl+Backspace | Move the note to the trash | tested |
| Note | Ctrl+. | Note menu | tested |
| Note | Ctrl+L | Copy link | fixed, tested |
| Note | Ctrl+D | Duplicate | fixed, tested |
| Note | Ctrl+Z | Undo in the editor | editor's own, tested |
| Board | Delete, Backspace | Remove the selection | fixed, tested |
| Board | Ctrl+Z | Undo a removal, for 8 s | tested |
| Board | 1, 2, 3 | New note, activity, area | tested |
| Board | Enter, Space | Open the focused card | tested |
| Layers | Esc | Close peek, side editor, menu, drag | one stack, tested |
| Lists | Arrows, Home, End | Move in menus, tabs and lists | per component, tested |
| Calendar | Enter | Open the focused block | tested |
| Calendar | T, J, K, arrows, D, W, M, N | Today, move, view, new | tested |
| App | ? | The shortcuts of the current screen | tested |

"Registered" only means the plugin accepted the chord. Whether global chords
fire on KDE under Wayland was not tested.

## Proposed design

### P1 One table

`src/lib/shortcuts`: every shortcut once, with id, keys, scope, label key and
platform form (`Mod` is Ctrl or Cmd). Menus, tooltips, the palette and Settings
read their hints from it, so a hint cannot exist without a shortcut.

### P2 One listener and one guard

`useShortcut(id, handler)` on a single window listener. Plain keys never fire in
a text field; chords may when the table says so. Scopes go from most to least
specific, and a dialog blocks what is underneath. A libraries' key handling that
competes gets an explicit test, as React Flow's does.

### P3 Escape closes one layer

A stack: each open layer registers, and Esc closes only the top one.

### P4 Discoverable

`?` opens a sheet with every shortcut of the current screen. Settings lists all
of them.

### P5 Calendar keys

T today, J and K or the arrows to move, D, W and M for the view, N for a new
meeting, Enter to open, as Google Calendar does.

### P6 System chords can change

Rebinding in Settings, reporting a chord that fails to register or belongs to
another app where that can be known.

The new chord is registered before the old one is released, so a refused chord
changes nothing. `update_config` no longer writes the chords: a page holding an
older copy of the config could undo a rebind. A chord that fails at startup shows
on its row and in a notice outside Settings.

What can be known differs by desktop. The OS reports a chord another registration
holds (`taken`). On KDE, `kglobalshortcutsrc` and `X-KDE-Shortcuts` name the app
that declares a chord. Elsewhere nothing can be read, and silence does not mean
free.

**Whether a global chord fires under Wayland is still unverified.** The plugin is
X11-only on Linux: on Wayland it talks to XWayland, so it can accept a chord the
compositor keeps. No test here presses a real key through a compositor;
`pnpm test:shortcuts` checks the row and what the desktop's event does. So each row
shows the last press actually received, and under Wayland the page says accepted is
not proof. That is how the owner can check it: press the chord with another window
focused and read the time on the row.

Not unified: the arrow-key code of each list and menu stays in its component,
declared in the table. No proposal above asks for one implementation, and they
differ in what they do (roving focus, active descendant, tab selection).

## Acceptance criteria

- [x] Every shortcut advertised in the note menu does what it says.
  (`useNoteShortcuts.test.ts`, `pnpm test:shortcuts`)
- [x] Delete, Backspace and undo work with the real React Flow.
  (`WorkspaceRoute.realFlow.test.tsx`, `pnpm test:shortcuts`)
- [x] The table is the only source of hints, and a test fails on a keydown
  listener outside it. (`contract.test.ts`)
- [x] `pnpm test:shortcuts` is generated from the table, so a new shortcut
  cannot ship untested. (`shortcuts.mjs` reads the table through Vite and runs one
  probe per chord; `contract.test.ts` fails on an entry with no probe)
- [x] Esc closes one layer at a time. (`registry.test.tsx`, the `layer.close` probe,
  with the editor's slash menu and a Radix select among the layers)
- [x] `?` lists the current screen's shortcuts. (`ShortcutSheet.test.tsx`, the
  `app.help` probe)
- [x] The calendar keys work. (`MeetingsHub.keys.test.tsx`, the `calendar.*` probes)
- [x] A system chord can be changed, and a failure to register is visible.
  (`shortcuts.rs`, `shortcut_conflicts.rs`, `ShortcutsSection.test.tsx`, the rebinding
  section of `pnpm test:shortcuts`)
- [x] Deleting from the side editor works in the real webview, with an undo.
  (`trashUndo.test.tsx`, `WorkspaceRoute.realFlow.test.tsx`, `CommandPalette.test.tsx`,
  the trash section of `pnpm test:shortcuts`)
