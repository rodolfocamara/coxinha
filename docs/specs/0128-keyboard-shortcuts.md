# 0128 — One keyboard shortcut system

Status: draft
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

## Inventory (2026-11-04)

| Scope | Keys | Action | State |
|---|---|---|---|
| System | Ctrl+Alt+Y | New note | registered |
| System | Ctrl+Alt+O | Open the app | registered |
| System | Ctrl+Alt+G | Agenda | registered |
| System | Ctrl+Alt+T | Meetings | registered, but the owner's KDE gives it to a terminal |
| System | Ctrl+Alt+W | Start or stop recording | registered |
| App | Ctrl+K, Ctrl+P | Palette | tested |
| Palette | Up, Down, Enter, Esc | Move, open, close | Esc tested |
| Palette | Ctrl+Backspace | Delete the note | not in the browser check |
| Note | Ctrl+. | Note menu | tested |
| Note | Ctrl+L | Copy link | fixed, tested |
| Note | Ctrl+D | Duplicate | fixed, tested |
| Note | Ctrl+Z | Undo in the editor | editor's own, not in the browser check |
| Board | Delete, Backspace | Remove the selection | fixed, tested |
| Board | Ctrl+Z | Undo a removal, for 8 s | tested |
| Board | 1, 2, 3 | New note, activity, area | tested |
| Board | Enter, Space | Open the focused card | unit test only |
| Layers | Esc | Close peek, side editor, menu, drag | peek, side editor and note menu tested |
| Lists | Arrows, Home, End | Move in menus, tabs and lists | per component |
| Calendar | Enter | Open the focused block | no other key |

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

## Acceptance criteria

- [x] Every shortcut advertised in the note menu does what it says.
  (`useNoteShortcuts.test.ts`, `pnpm test:shortcuts`)
- [x] Delete, Backspace and undo work with the real React Flow.
  (`WorkspaceRoute.realFlow.test.tsx`, `pnpm test:shortcuts`)
- [ ] The table is the only source of hints, and a test fails on a keydown
  listener outside it.
- [ ] `pnpm test:shortcuts` is generated from the table, so a new shortcut
  cannot ship untested.
- [ ] Esc closes one layer at a time.
- [ ] `?` lists the current screen's shortcuts.
- [ ] The calendar keys work.
- [ ] A system chord can be changed, and a failure to register is visible.
