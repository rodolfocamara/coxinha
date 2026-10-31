# Specs — Spec-Driven Design

One spec per feature. A spec captures **what** has to exist and
**how we'll know it's done** (acceptance). Technical **how** lives
in [`docs/architecture/`](../architecture/) (overview + ADRs).

Golden rule: **code is born from a spec, a spec is born from a
decision**. If a PR does not fit any spec, or a spec is missing,
either the spec needs writing or the PR is out of scope.

## Conventions

- 4-digit numbering: `0001-*.md`
- **Numbers reflect implementation order.** Spec `NNNN` is the
  `NNNN`-th thing we ship, period. No sub-phases, no "Foundation /
  Critical path / Polish" labels — order is the number.
- Don't renumber casually. A reshuffle happened once during the
  initial consolidation; going forward, new specs append, and a
  rejected feature keeps its slot with `status: rejected`.
- Phase declared in the header (F1, F1.5, F2, F3, F4)
- Small specs over giant ones. Past ~200 lines, split into sub-specs.

## Status

- `draft` — no consensus yet, big changes still possible
- `in-progress` — implementation started
- `done` — merged to main, acceptance passed
- `rejected` — decided against; file kept for history

## Index

### F1 — Local-first MVP

Implement in numeric order. Cold-start check lands as spec 0003
on purpose — measured early, tracked on every PR from then on.

| #    | Feature                                                                           | Status      |
| ---- | --------------------------------------------------------------------------------- | ----------- |
| 0001 | [Build & dependency baseline](./0001-build-baseline.md)                           | in-progress |
| 0002 | [Testing & reliability baseline](./0002-testing-baseline.md)                      | done        |
| 0003 | [Cold-start + load benchmarks](./0003-cold-start-load.md)                         | draft       |
| 0004 | [Database migrations](./0004-db-migrations.md)                                    | draft       |
| 0005 | [Notes, daily notes, and search](./0005-notes-and-search.md)                      | in-progress |
| 0006 | [App shell — tray, auto-launch, global shortcuts](./0006-app-shell.md)            | in-progress |
| 0007 | [Recording & call detection](./0007-recording-and-call-detection.md)              | draft       |
| 0008 | [Meeting pipeline — transcribe + diarize + summarize](./0008-meeting-pipeline.md) | draft       |
| 0009 | [Meetings list view](./0009-meetings-list.md)                                     | in-progress |
| 0010 | [Settings view UI](./0010-settings-view.md)                                       | draft       |
| 0063 | [Integrated window chrome](./0063-integrated-window-chrome.md)                    | in-progress |
| 0064 | [Collapsible workspace sidebar](./0064-collapsible-workspace-sidebar.md)          | in-progress |
| 0065 | [Dash navigation and Sana content](./0065-dash-navigation-and-sana-content.md)    | in-progress |
| 0066 | [Desktop window contract](./0066-desktop-window-contract.md)                      | in-progress |
| 0067 | [Rounded native window](./0067-rounded-native-window.md)                          | in-progress |
| 0068 | [Meeting sessions and activity map](./0068-meeting-sessions-and-activity-map.md)  | in-progress |
| 0069 | [Stable note identity and lossless metadata](./0069-stable-note-identity.md)      | in-progress |
| 0075 | [Board editing and quiet session navigation](./0075-board-session-refinement.md)  | in-progress |
| 0076 | [Opaque search dialog](./0076-opaque-search-dialog.md)                            | in-progress |
| 0077 | [Session people and voices workspace](./0077-speaker-curation-workspace.md)       | in-progress |
| 0070 | [Meeting session persistence](./0070-session-foundation.md)                       | in-progress |
| 0071 | [Session workspace and recoverable personal notes](./0071-session-workspace.md)   | in-progress |

### F1.5 — Rich blocks and real-product polish

| #    | Feature                                                            | Status |
| ---- | ------------------------------------------------------------------ | ------ |
| 0011 | [Mermaid block](./0011-mermaid-block.md)                           | draft  |
| 0012 | [Excalidraw block](./0012-excalidraw-block.md)                     | draft  |
| 0013 | [Wiki-links `[[note]]`](./0013-wiki-links.md)                      | draft  |
| 0014 | [Tags `#project`](./0014-tags-filter.md)                           | draft  |
| 0015 | [Vault import](./0015-vault-import.md)                             | draft  |
| 0016 | [Vault backup & export](./0016-backup-and-export.md)               | draft  |
| 0017 | [Installer & first-run onboarding](./0017-installer-onboarding.md) | draft  |
| 0018 | [External edit conflicts](./0018-external-edit-conflicts.md)       | draft  |

### F2 — Optional sync

| #    | Feature                                                  | Status |
| ---- | -------------------------------------------------------- | ------ |
| 0019 | [Sync backend (Axum + Postgres)](./0019-sync-backend.md) | draft  |
| 0020 | [Sync client + WebSocket](./0020-sync-client.md)         | draft  |
| 0021 | [Conflict resolution (CRDT)](./0021-crdt-conflict.md)    | draft  |
| 0022 | [Read-mostly web UI](./0022-web-read-ui.md)              | draft  |
| 0023 | [Auth (Keycloak / JWT)](./0023-auth.md)                  | draft  |

### F3 — External integrations

| #    | Feature                                               | Status |
| ---- | ----------------------------------------------------- | ------ |
| 0024 | [Microsoft Graph OAuth](./0024-oauth-microsoft.md)    | draft  |
| 0025 | [Google Calendar/Tasks OAuth](./0025-oauth-google.md) | draft  |
| 0026 | [MS Todo / Google Tasks sync](./0026-tasks-sync.md)   | draft  |
| 0027 | [GitHub PRs/issues sync](./0027-github-sync.md)       | draft  |
| 0028 | [Azure DevOps sync](./0028-azdo-sync.md)              | draft  |
| 0029 | [Unified daily timeline](./0029-unified-timeline.md)  | draft  |

### F4 — Advanced AI layer

| #    | Feature                                                | Status |
| ---- | ------------------------------------------------------ | ------ |
| 0030 | [Automatic embeddings](./0030-embeddings.md)           | draft  |
| 0031 | [Embedded vector store](./0031-vector-store.md)        | draft  |
| 0032 | [Chat with the vault](./0032-chat-vault.md)            | draft  |
| 0033 | [MCP server](./0033-mcp-server.md)                     | draft  |
| 0034 | [Long-term memories](./0034-long-term-memory.md)       | draft  |
| 0035 | [Pre-meeting briefing](./0035-pre-meeting-briefing.md) | draft  |
| 0036 | [Auto-tag + auto-link](./0036-auto-tag-link.md)        | draft  |

### F1.5 addendum

| #    | Feature                                                           | Status |
| ---- | ----------------------------------------------------------------- | ------ |
| 0037 | [Obsidian vault adoption](./0037-obsidian-vault-adoption.md)      | draft  |
| 0038 | [Embedded dictation (hold-to-talk)](./0038-embedded-dictation.md) | draft  |

## Template

```md
# Spec NNNN: Short name

- **Status:** draft | in-progress | done | rejected
- **Phase:** F1 | F1.5 | F2 | F3 | F4
- **Owner:** name
- **Depends on:** links to other specs / ADRs
- **Relevant ADRs:** ADR-NNNN

## Why

User problem in 2-3 sentences. Link evidence when available.

## Scope

### In

- explicit list of what's included

### Out

- explicit list of what is NOT included (point to another spec if
  applicable)

## Behavior (acceptance)

Verifiable criteria. Use "Given / When / Then" or short imperatives.
Each bullet must be testable (manually or automated).

## Design notes

Affected modules, IPC commands, DB tables, vault paths. Keep short —
heavy detail belongs in `docs/architecture/`.

## Open questions

Pending decisions that block or shape the implementation.
```

- [0081 — Inline activities and consistent desktop controls](0081-inline-activity-design.md) — in-progress

- [0082 — Default audio devices](0082-default-audio-devices.md) — implemented

- [0083 — Local meeting detection](0083-local-meeting-detection.md) — in-progress

- [0084 — Freeform activity canvas](0084-freeform-activity-canvas.md)

- [0085 — Board item resizing](0085-board-item-resizing.md)

- [0086 — Quiet activity nodes and direct recording consent](0086-quiet-nodes-direct-capture.md)

- [0087 — Meeting boundaries and reversible sessions](0087-meeting-boundaries-and-reversible-sessions.md) — in-progress

- [0088 — Visible local processing lifecycle](0088-visible-local-processing.md) — in-progress

- [0089 — Local incremental transcription](0089-local-incremental-transcription.md) — in-progress

- [0090 — Recoverable processing publication](0090-recoverable-processing-publication.md) — in-progress

- [0091 — Recording transparency and joint playback](0091-recording-transparency-and-joint-playback.md) — in-progress

- [0092 — Global people and visible recording controls](0092-global-people-and-recording-controls.md) — in-progress

- [0093 — Sidebar live recording pill and unified status](0093-sidebar-recording-status.md) — in-progress

- [0094 — Meeting end/boundary prompt, focus bring-up and UI simplification](0094-meeting-end-prompt-and-simplification.md) — in-progress

- [0096 — Frontend redesign (Hoje, Reuniões, Workspace, one recorder)](0096-frontend-redesign.md) — in-progress
