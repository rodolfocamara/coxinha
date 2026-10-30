# 0085 — Board item resizing

Status: done
Phase: Desktop activity map

## Why

Activities lack direct resize handles and their automatic height ignores explicit
height changes. Area handles are difficult to discover and resizing their left
edge must not move contained activities.

## Contract

- Selected activities, free text and areas expose themed corner and edge handles.
- Width and minimum height persist through the existing board save queue. Content
  remains fully visible and can grow beyond the requested minimum; no clipping.
- Activity handles cannot shrink below current content height. Areas cannot shrink
  across children; resizing an area keeps child coordinates fixed, while moving
  the area still translates children. No parent or note identity changes.
- The existing inspector width/height fields remain the keyboard alternative.
- Read-only measurements do not save or migrate a board. No schema or Rust change.

## Non-goals

New note formats, layout automation, changing completion, capture or storage.

## Validation

Focused geometry and component tests, typecheck, real browser resize at desktop
and narrow widths with zoom/reload and containment, isolated native build and
Linux interaction before updating the authorized local launcher.
