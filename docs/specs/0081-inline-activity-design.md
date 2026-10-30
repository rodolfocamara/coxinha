# 0081 — Inline activities and consistent desktop controls

Status: implemented
Phase: desktop refinement
Why: Native select menus break the theme; selected areas cover activities; detached editing interrupts spatial context; settings and repeated headers consume useful space.
Non-goals: automatic task extraction, provider sync, voice changes, data deletion, note format changes, unrelated window/lifecycle changes.

## Interaction contract

- Use a shared accessible themed select for app-owned selects. Popup surfaces are opaque and use design tokens, with keyboard selection, typeahead, Escape and focus restoration. Nested period popup stays open while choosing an option.
- A new activity immediately appears at the current canvas viewport as a pending container while its canonical note is created. Failure stays visible with retry or dismiss; no phantom reference is persisted. Success attaches the actual note once and edits it in the same card, with no route change or detached side panel.
- Existing cards edit on explicit edit/double-click. Opening expands only display geometry and centers the requested card. Stored geometry is preserved; manual pan/zoom remains available and closing restores card dimensions without recentering. Markdown save queue, upload tracking, retained recovery and exit flushing remain unchanged.
- Completion is manual integer 0–100, persisted on the board item. Old cards start at 0. A number, progress bar and color communicate state even zoomed out: neutral at zero, amber below 50, blue below 100, green at 100. Color is never the sole indicator. Area colors remain manually chosen.
- Areas always render behind every activity, including selected areas. Selection never elevates a node. Bring-to-front/send-to-back reorder within kind only; array order persists, no unbounded z values. Connections remain visible above areas.
- Board JSON v2 adds progress. Read v1 and v2; old missing progress defaults to zero, all other validation and revision conflict protection preserved. Save emits v2 atomically; invalid progress or future versions fail closed. Old binaries may refuse v2, never silently erase it. Do not rewrite user files during this work. Keep a pre-v2 board backup on the first explicit save migration.
- Meeting sessions becomes a plain section heading plus filter and create buttons. Dates remain small collapsible group labels with indented meetings; old whole-section collapse preference no longer hides content.
- Reduce duplicate headers and vertical spacing, retaining native drag/control dimensions. Settings use category navigation and grouped preference rows, recovery links remain actionable, and disabled vault migration controls remain disabled.

## References

- Linear preference navigation and compact rows: https://mobbin.com/screens/8720abc2-c855-44ee-911d-bc15fc1707eb
- Notion appearance/settings controls: https://mobbin.com/screens/a535975a-c988-47a1-89fd-a5bf46a0123a
- Miro contextual card actions/status: https://mobbin.com/screens/a92c6f99-0daf-4c40-ba72-a4ea3a6bb03c

Retain Coxinha colors, typography, brand and persistence. User specifically chose editing inside the activity, so do not copy Miro's detached details panel.

## Proof

Test old board load/migration/backup, revision conflict, progress validation/roundtrip, selected-area layering and same-kind reorder. Test create pending/success/failure, inline editing without navigation, selector keyboard/nested focus, date collapse and settings recovery navigation. Run typecheck, relevant/full frontend and bounded Rust library checks. Native installation requires a pinned integrated build; no operator data is used in tests.

## Implementation evidence

Implementation and validation are recorded under `target/board-design-20261025/`. Browser contracts cover light/dark at 800/1280 px with real BlockNote and synthetic IPC. A separate private Linux WebKitGTK/KWin run creates and edits a real synthetic note, saves completion, verifies the exact legacy backup, resizes in eight directions and closes through the normal save protocol. No operator profile is read or modified by those tests. Windows and physical mixed-DPI acceptance are not claimed.

The installed process may continue running the previous version until the user closes and reopens it. The new board version is written only on an explicit board change, not by loading it. The first pre-v2 backup is retained at `.coxinha/board-before-v2.json` and is never overwritten by later saves. Completion is manual; automatic task extraction remains a separate feature.
