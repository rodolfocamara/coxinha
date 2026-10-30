# Integrated desktop window

## Scope

The user supplied T3 Code and Coxinha screenshots and requested removal of the separate light OS titlebar. Spec 0063 reuses the existing themed ChromeCap as a single header, with a blank drag region and translated minimize, maximize/restore and close buttons. The reference is the supplied T3 Code screenshot; no branding or assets were copied.

The main window uses `decorations: false`. Only minimize, toggle-maximize and start-dragging permissions were added. Existing `close()` dispatches CloseRequested to the unchanged desktop lifecycle, which prevents immediate closure and runs save/stop confirmation. No destroy/process-exit path was added.

## Executed validation

- Frontend: 195 tests in 37 files passed. TypeScript and production Vite build passed; the pre-existing large-chunk warning remains.
- Browser: light and dark, native action routing through synthetic IPC, restore-state updates, drag/double-click, 800px minimum width, visible controls and no page errors. Screenshots and raw results live in `target/window-chrome-validation-20261024/`.
- The T3 preview opened, but two snapshot calls failed with `Preview automation snapshot timed out after 15000ms.` Browser validation used the repository's documented Playwright workflow with synthetic data only.

## Read-only runtime verification

Installed `tauri-runtime-wry` 2.10.1 installs undecorated resize handling in Linux and Windows; tao 0.34.8 also handles edge resizing for resizable undecorated windows. This source inspection is not native compositor acceptance.

## Acceptance boundary

Actual dragging, edge resizing, maximize/restore and the close confirmation still require desktop smoke acceptance on Linux and Windows. Browser IPC mocks prove dispatch and layout, not OS behavior. User data/preferences and previous executables are preserved. No commit, push, deployment, recording or tenant change.

## Local candidate

Linux desktop build passed (`desktop-build.log`). Launcher `target/recognition-validation-20261023/launch-demo` now selects `coxinha-desktop-integrated-v1`; previous launcher preserved as `launch-demo.before-integrated-20261024`. SHA-256: `5a65c7b7c929b99f33cb5fb0f13ff2276d82e28842f6475cf3a52b9ca7691d49`. Build ID: `86d146af4058-1792836054`. Source and dist hashes were reverified before installation.

Fable independent review R1 remains in progress. This candidate is available for local testing; review and real native acceptance are not yet complete.

## R1 corrections and v2 candidate

Fable R1 independently ran six focused tests and confirmed the lifecycle-aware close path and resize permissions. Accepted findings: double-click handling now uses the second mousedown, following the installed Tauri script; all maximization reads share revision/disposal guards; chrome slots can shrink. Deferred tests cover stale results and unmount. Native compositor acceptance remains pending.

The first full-suite R2 run exposed a pre-existing RecordingStatus test fixture that returned active forever, even after stop. The test now models the backend becoming inactive and advances fake timers to verify subsequent polling. No recording production code changed. All 197 tests in 37 files then passed (`r2/frontend-final.log`); frontend and Linux desktop builds passed. Browser actions, long note title at 800px, dark and light layouts passed with synthetic IPC.

Launcher now selects `coxinha-desktop-integrated-v2`, SHA-256 `950b89dded04192c08c0790b0a22fe9725659325bbabbeca4ca0ff83f0425010`, build ID `86d146af4058-1792836393`; v1 and prior launcher remain intact. Fable R2 focused revalidation is in progress.

## Final review and candidate

Fable R2 verified 9/9 pinned files, independently ran 8 focused tests and found no blockers. All R1 findings are resolved. The reviewer referenced the initial flaky RecordingStatus log; the corrected fixture and green 197-test run were already recorded in `r2/frontend-final.log`.

A pre-existing tab chip overflow under a very long title was fixed with `min-w-0` on the tab button after R2. Final browser assertions verify that the tab fits its parent and does not overlap the breadcrumb at 800px, in both themes. This one-line CSS fix was verified by root, not a third review round. Final frontend and Linux desktop builds passed.

Launcher now selects `coxinha-desktop-integrated-v3`, SHA-256 `91397b91d5c00cb0dab08996a2aa8615a2e7aaa801577071c61d5387fe67f323`, build ID `86d146af4058-1792836612`. Prior binaries and launcher backups remain available. Native Linux compositor/Windows acceptance is still pending; macOS double-click convention is outside this Linux/Windows increment. No further delegated work remains.
