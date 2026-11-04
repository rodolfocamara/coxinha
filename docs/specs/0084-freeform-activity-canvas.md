# 0084 — Freeform activity canvas

Status: done
Phase: Desktop activity map

## Why

Activities currently collapse to their title and mount the full document editor.
Areas are decorative rectangles rather than durable containers. The user wants
complete activity content on a free canvas, simple inline editing and derived
area completion.

## Contract

- Cards always display complete content and grow with it; only the active card
  mounts a text editor. First line is the title; paragraphs, bullets, checklists,
  bold/italic and selected-text colors are available without document/session UI.
- Tiptap is configured as a small editor. Notes remain Markdown; selected colors
  use a restricted inline HTML span (six-digit hex only). Unsupported Markdown
  blocks remain intact as opaque source instead of disappearing on edits.
  Loading alone never rewrites a note. The shared save queue, recovery and exit
  barrier remain authoritative. Colored notes opened outside the board use the
  same lossless editor path. Color round trips require tests.
- Free text is a Markdown note-backed canvas item, independent of activity
  completion. Toolbar or double click on empty canvas creates it immediately.
- Board v3 adds optional parentId and the text item kind. Positions remain
  absolute in the canonical sidecar; movement of an area translates children.
  This avoids changing old coordinates on load. No automatic membership is
  inferred for existing boards. A visible drop target assigns a card/text to one
  area; areas cannot nest. Dropping outside detaches. Keyboard-accessible parent
  selection is available. Area resize cannot hide children; content growth
  expands its containing area. Areas always stay behind cards/text.
- Area progress is the rounded arithmetic mean of direct activity children;
  text does not count. Partial progress is displayed between 1 and 99 so rounding
  never declares a partially completed area done or unstarted. Empty areas report
  no activities, never completion.
  Labels distinguish not started / in progress / completed, with percent and
  color. Area progress is derived, not independently editable or persisted.
- Removing an area releases children in place and never deletes notes. Removing
  any visual item never deletes its note. Save upgrades v1/v2 only after explicit
  mutation and preserves exact legacy bytes in a versioned backup; reads do not
  write. Existing conflict/recovery semantics remain.

## Non-goals

Canvas engine replacement, collaboration, arbitrary HTML execution, nested areas,
automatic AI tasks, destructive note migration, changing session workflows.

## Validation

Rust sidecar legacy migration/backup, invalid/cyclic parents, text references,
stale writes and no mutation on failed validation. Frontend Markdown/color/opaque
content round trips, retained failed saves, area movement/drop/detach/growth/mean,
full content visibility, one active editor and creation focus. Browser screenshots
at narrow and wide desktop sizes, keyboard and drag/drop on the real editor;
isolated build/native acceptance before the local launcher update.

## References

https://help.milanote.com/en/articles/112349-creating-your-first-project
https://affine.pro/blog/getting-started-with-affine
https://tiptap.dev/docs/editor/core-concepts/extensions
https://reactflow.dev/api-reference/types/node

## Acceptance boundaries

Linux acceptance uses a private WebKitGTK/KWin session and disposable vault. It
covers inline title/bullet creation, durable Markdown, exact legacy board backup,
area creation and normal save-and-close. Browser acceptance covers actual Tiptap
editing, text-color reload, visible full content, drag containment, group movement,
mean completion and free text at 800/1280 px in light/dark themes.

Only the active item mounts Tiptap. This is not a claim of reduced native RSS;
large-board performance and Windows acceptance remain unmeasured. Arbitrary
Markdown extensions are preserved as inert source instead of editable rich blocks.
Activities retain explicit completion values; checklist changes do not implicitly
redefine their completion. Areas derive completion from those activity values.
