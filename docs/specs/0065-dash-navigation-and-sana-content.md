# Spec 0065: Dash navigation and Sana content

- **Status:** in-progress
- **Phase:** F1
- **Depends on:** [0062](./0062-comfortable-board-and-system-theme.md), [0063](./0063-integrated-window-chrome.md), [0064](./0064-collapsible-workspace-sidebar.md)

## Why

The user selected “the menu from 1 and the rest from 3” after comparing real
Mobbin references. Retain the compact Dropbox Dash navigation already introduced
in 0064 and apply Sana AI's discreet header, breathable content, readable text
and contextual actions to existing meeting workflows.

## References

- [Dropbox Dash](https://mobbin.com/screens/6b56d60a-fe8a-456c-a155-c007db13b612): quiet labeled navigation, separate recents, search shortcut and bottom settings.
- [Sana AI](https://mobbin.com/screens/890bfc70-836b-473f-b72a-0b2ddfd07626): discreet header, generous content spacing, dividers and readable detail.
- Local inspected references: `target/sidebar-validation-20261024/references/{dash,sana}.webp`.

Reuse organization only, keeping Coxinha branding and the comfortable graphite
and light tokens from 0062.

## Scope

- Preserve the top-left brand and collapse/focus behavior; make only explicit
  blank brand-header space draggable with the same handler as WindowChrome.
- Present a single route as a quiet title or breadcrumb, without a fake tab or
  duplicate route label. Retain real multi-tab rendering when supplied.
- Refine meeting library sections, spacing, dividers, primary capture action
  and detail readability. Keep capture, status, recovery, playback, processing,
  transcription and identity actions visible and functional.
- Reuse existing keybindings for the decorative search shortcut. Remove only
  verified unused props and locale entries; scope styles to affected content.

## Non-goals

No AI chat, summary/search features, automatic capture claims, async state-flow
rewrite, board canvas redesign, note persistence changes, native close lifecycle
changes, launcher changes, backend changes, commits, delivery or user-data writes.

## Behavior and validation

- Shared native blank-space handling: left mousedown detail 1 drags and detail 2
  toggles maximize, guarded by target equality, preventDefault and propagation
  stops. Buttons and brand content cannot initiate drag. Errors are accessible.
- One native resize listener per shell, preserving revision/disposal guards.
- Collapse/expand transfers focus; collapsed toggles do not reference a missing
  sidebar ID. Search's shortcut is absent from its accessible name.
- Single-page title/breadcrumb deduplication and real multiple tabs have focused
  coverage. Existing library action, polling, selection and recovery tests pass.
- Focused frontend tests and TypeScript checks run in implementation. Full suite,
  browser light/dark/narrow acceptance and Cargo checks belong to the parent
  review. Native desktop and user acceptance remain separate gates.

## Implementation evidence

- 2026-10-24: focused Vitest passed, 45 tests in 7 files (WindowChrome,
  AppShell sidebar, ChromeCap, LibraryView, ProcessingPanel, NoteEditor persistence
  and HomeCanvas). `pnpm typecheck` passed.
- CaptureSection is controlled presentation; LibraryView retains its asynchronous
  state and IPC ownership and is reduced to 300 lines.
- Browser, full-suite, Cargo, native desktop and user acceptance remain pending
  in the parent review. This spec remains in-progress.
