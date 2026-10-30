# Desktop sidebar refinement

## Reference and scope

The user requested a desktop sidebar resembling the structural approach of T3 Code: app identity at the top, collapsible navigation, no back/forward controls and no horizontal icon strip. Actual Mobbin screen images were inspected, not just metadata:

- [Microsoft Loop](https://mobbin.com/screens/61a78a2b-79c1-4f38-ab12-132ad1637c7a): branding and sidebar controls at the top aligned with the content header.
- [Dropbox Dash](https://mobbin.com/screens/6b56d60a-fe8a-456c-a155-c007db13b612): compact labeled navigation, search and separated recents.
- [Sana AI](https://mobbin.com/screens/890bfc70-836b-473f-b72a-0b2ddfd07626): clear functional entries and settings at the bottom.

No third-party assets were copied. Existing Coxinha mark and comfortable theme tokens are retained. Spec 0064 defines the implementation.

## Behavior

The sidebar spans the full window height, with logo/name and a collapse control at the top. Home, meeting library, board, agenda and search have labeled vertical rows; real recent notes are a separate group. Settings stays at the bottom. Empty placeholder groups, duplicate note links, the horizontal quick-icon row and inactive workspace-options button are removed.

When collapsed the sidebar is fully removed from layout and the content header exposes a reopen control and compact logo. State is scoped to `coxinha:workspace-sidebar`, separate from the existing context-panel preference. Keyboard focus moves to the replacement toggle. Native window controls and close/save lifecycle are unchanged.

## Evidence

- 206 frontend tests across 39 files passed (`frontend.log`). TypeScript/Vite and Linux desktop builds passed; the existing bundle-size warning remains.
- Real Chromium with synthetic Tauri IPC: both themes, expanded/collapsed at 1200px, 900px and 800px layouts, logo at top, no back/forward controls, sidebar focus, reload persistence, search opening, agenda navigation, visible window controls/settings and no page errors (`browser-audit.json`).
- All 11 reviewed source hashes remained unchanged during browser/tests/build.
- T3 preview opened after restarting the local Vite server. Two snapshots failed with `Preview automation snapshot timed out after 15000ms.` Validation used the documented repository Playwright workflow.

Artifacts: `target/sidebar-validation-20261024/`. All browser notes/boards were synthetic; no user data or preference was reset. Native Linux compositor/Windows acceptance remains distinct from browser checks. No commit/push/deployment.

Fable independent review R1 is in progress.

## Local candidate

Launcher `target/recognition-validation-20261023/launch-demo` now selects `coxinha-desktop-sidebar-v1`, SHA-256 `93b59964136986319ee075177d7f42526534aa47a6dff831563a223697898812`, build ID `86d146af4058-1792840321`. Previous launcher is preserved as `launch-demo.before-sidebar-20261024`; all data directories/preferences and prior executables remain intact. Candidate is available for local testing while independent review completes.

## Independent review R1

Fable verified all 11 source hashes, independently ran 20 focused tests and typecheck, and found no blocker. One native UX issue remains: the blank brand-header space in the expanded sidebar does not yet support dragging; the content header still does. Proposed correction is to reuse the existing explicit blank-region drag behavior without making the collapse control draggable. Low findings: collapsed aria-controls points at an unmounted sidebar, keyboard shortcut hint discoverability, obsolete props/locale keys and spec index/header conventions. The user is now comparing three visual directions before the next refinement. No native acceptance was claimed.
