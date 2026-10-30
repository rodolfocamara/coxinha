# Comfortable board and system theme

## Result and scope

The board now uses warm graphite/off-white surfaces, a subtle grid, readable native controls, and a collapsible contextual inspector. Position/size and dependencies are collapsed initially. Existing-note insertion is grouped in a compact popover. Canonical notes, geometry, dependencies and persistence remain unchanged.

The screenshot supplied by the user already showed the dark Coxinha palette; it did not prove that OS detection failed. The old dark canvas token had lightness 0.058, yielding an almost-black surface. Separately, native form controls and ReactFlow controls/minimap were not consistently themed.

## References actually inspected

| Mobbin reference | Applied pattern |
| --- | --- |
| [Craft](https://mobbin.com/screens/66b19439-76a3-4493-8e8a-38d95b154645) | Compact controls and space for the canvas. |
| [Miro](https://mobbin.com/screens/a92c6f99-0daf-4c40-ba72-a4ea3a6bb03c) | Neutral canvas, distinct cards and contextual properties. |
| [Fibery](https://mobbin.com/screens/99741643-6f33-4727-8a4a-594c33d3b2ba) | Quiet navigation and secondary editing tools. |

Patterns were adapted to existing Coxinha tokens; no assets or branding were copied.

## Theme contract

- Default remains automatic; explicit light/dark preferences are never reset.
- Initial HTML and pre-mount initialization honor the saved preference. The applied theme drives HTML, editor, ReactFlow and CSS `color-scheme`.
- Linux follows the live WebKit `prefers-color-scheme` preference. The installed tao 0.34.8 implementation, `src/platform_impl/linux/window.rs::theme`, checks GTK theme-name suffixes instead of the desktop portal preference. Prioritizing that native answer could overwrite a correct dark web preference with light. Native theme reads are deliberately skipped on Linux.
- On Windows/macOS, Tauri initial theme and theme-change events take priority when available. Media-query fallback remains live if native support fails; late reads/listeners cannot overwrite a newer event or an explicit preference.
- Read-only host checks returned GNOME `prefer-dark` and portal color-scheme `1`. No desktop settings were changed. This is not an acceptance test of live native theme switching.

## Executed validation

Artifacts are local under `target/visual-validation-20261024/`.

| Check | Result |
| --- | --- |
| Frontend suite | 189 tests across 36 files passed (`frontend-r2.log`). |
| TypeScript and production build | Passed (`frontend-build-r2.log`); existing large-chunk warning retained. |
| Linux desktop build | Passed with `local-processing,tauri/custom-protocol` (`desktop-build-r2.log`). |
| Real Chromium board in light/dark | Empty/populated/selected views at 1440, 1200 and 900px, keyboard movement, OS media changes, explicit preference override, no horizontal overflow or page errors (`visual-audit.json`). |
| Browser integration with synthetic native IPC | Persisted board visible on initial load, Windows-like native/media mismatch and event handling, manual preference preserved through native events and reload (`theme-integration.json`). |
| Note/persistence regression browser flow | Keyboard move, dependency, save, reopen during pending write, retained-note recovery/retry, unavailable-note navigation and passive offline agenda passed (`browser-audit.json`, `regression-audit.log`). |
| Sampled text contrast | Every measured board label/action/card/help sample passes 4.5:1 in both themes; raw colors and ratios in `visual-audit.json`. This is a scoped measurement, not whole-application WCAG certification. |

A batch-loaded board exposed nodes that remained hidden after controlled remaps. Nodes now carry the canonical fixed width/height/measurement as well as CSS dimensions. Both batch and initial persisted-board browser cases pass. Fit-view controls are capped at zoom 1 so a small board is not enlarged unnecessarily.

The T3 preview opened, but two snapshots failed with `Preview automation snapshot timed out after 15000ms.` Validation used the repository's existing Playwright workflow. All browser datasets and native IPC were synthetic; no user notes, calendar data or recordings were used.

## Acceptance limits

Native desktop interaction and live OS-theme changes, Windows execution, physical capture and live Outlook OAuth remain separate acceptance steps. This increment does not enable automatic recording, change voice recognition thresholds or alter tenant credentials. Local tests/builds do not constitute user acceptance. No commit, push or deployment was made.


## Independent review and corrections

Fable R1 verified its 26-file snapshot and ran 36 tests plus typecheck in an isolated copy. Its inherited hidden-node finding was reproduced by root and fixed before R1 completed: canonical `measured` accompanies width/height on every controlled remap. The final browser probe also checks internal source-handle x and rendered edge path after width changes from 250 to 310, rather than accepting visible nodes alone.

Accepted R1 corrections: native input defaults now live in CSS `@layer base`, so deliberate Tailwind utility backgrounds win; inspector close restores keyboard focus to the persistent toggle; command-palette theme toggle reads the applied theme; minimap areas have no opaque fill; unused help translation removed. The Linux native-event concern is addressed by the deliberate media-only Linux source described above.

The R1 typography objection was a scope mismatch: the captured pre-task baseline already used system fonts and no Google Fonts request. The new design retains that baseline. No additional product decision or external font request is needed.

`review-regression.mjs` reproduces real ReactFlow node/edge measurements and resize, focus return, transparent command-palette input, light/dark color contrast and responsive layouts. Both theme runs passed with no page errors. This is frontend evidence with synthetic IPC, not native acceptance.

Fable R2 verified all 31 snapshot hashes against the live source and ran 68 focused tests across 9 files plus typecheck in an isolated copy. No reproducible medium/high defect remains in this delta. Delta SHA-256: `67627bd54e6da6f3d8c3d5be0646376865a422941a455b9c88554797ef72010b`.

After R2, root repeated the browser audit successfully and verified all 31 pinned hashes before and after execution (`browser-final.log`, `browser-final-provenance.json`). This closes the earlier screenshot-timestamp provenance concern. Only this report and the spec status were updated afterwards; implementation files are unchanged.

The existing demo launcher now selects `coxinha-desktop-comfort-v2`, SHA-256 `251990a6b391f8fd90990ce88ae5ffa7dd516882a409d8b8320e076ddfe7bd6e`, build ID `86d146af4058-1792835075`. Its original content is preserved as `launch-demo.before-comfort-20261024`. All demo data directories, preferences and previous binaries are preserved. Launch command: `/home/rcamara/Repos/coxinha/target/recognition-validation-20261023/launch-demo`.
