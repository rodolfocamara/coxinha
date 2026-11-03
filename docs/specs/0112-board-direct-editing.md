# 0112 — Board: rename, resize, delete and checklists on the canvas

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner's review of the activity board (2026-11-03): an area's name can
only change in the side editor, while Excalidraw renames a container with a
double click; cards are hard to resize; nothing can be deleted from the
canvas; an activity card shows one line of its note instead of its checklist;
and the board feels slow while dragging.

## Non-goals

- Deleting note files. Delete takes an item off the board; the note stays
  in the drawer (spec 0096 P5). The side editor keeps "delete note".
- Ticking checklist lines on the card. The side editor stays the one place a
  note is edited.
- Mobile layouts of the board.

## Design

### P1 Rename an area in place

- Double click on an area turns its name into a field, text selected. Enter
  or leaving the field saves (trimmed), Escape cancels. Typing never moves,
  deletes or pans anything.

### P2 Resize

- Cards no longer lift on hover or shrink while pressed: the resize handles
  sit inside the card and moved under the pointer, which made grabbing them
  unreliable. Hover changes only the border.
- Corner handles are 10px with a 20px grip; the sides grab across 10px
  instead of 1px. The selection outline still draws the edge.

### P3 Delete

- Delete or Backspace removes the selected item from the board, as in
  Excalidraw: an area frees its children, an activity or note loses its
  dependencies, and the side editor closes. Fields keep both keys for text.
- "“Name” saiu do quadro · Desfazer" stays for 8 seconds; Desfazer or Ctrl+Z
  brings the item back with its children and dependencies, keeping anything
  moved since.

### P4 Every checklist line on an activity

- An activity card lists every checklist line of its note, nested lines
  included and code blocks excluded, done lines struck through in grey. A
  card without a checklist keeps its one-line excerpt.

### P5 Responsiveness

- A card's React Flow node object is reused while its item, note, selection
  and size are unchanged, so dragging or resizing one item re-renders only
  that item instead of every card.
- Cards keep a 1px resting shadow and areas a flat tint, instead of a large
  blur and a gradient that the canvas repainted on every pan.

## Acceptance

- [x] Double click renames an area; Enter saves trimmed, Escape cancels
      (`WorkspaceRoute` tests).
- [x] Delete removes the selected activity with its links and closes the
      editor; Undo restores both; Backspace removes an area and Ctrl+Z puts
      its children back; a focused field keeps Delete (`WorkspaceRoute` and
      `useRemoveShortcut` tests).
- [x] Every checklist line shows on the card (`workspaceModel` and
      `WorkspaceRoute` tests).
- [x] Unchanged cards keep their node object (`boardNodes` tests).
- [ ] Owner: resizing feels direct, and dragging stays smooth on the real
      board.
