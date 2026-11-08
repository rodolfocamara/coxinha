# 0076 — Opaque search dialog

Status: styling implemented; 20 existing palette tests and scoped Prettier pass. Workspace typecheck is blocked by `ActivityBoard.tsx:360` (`void` callback versus `Promise<void>`). Parent browser acceptance and integration remain pending. Scope: bounded frontend styling on `feat/0058-meeting-library`, preserving the existing dirty working tree.

## Intent

Make the search command palette readable over a busy board with a solid surface and a lightly dimmed background. Retain the approved comfortable graphite dark theme and soft light theme through existing tokens.

## Behavior and acceptance

- Use the existing opaque `bg-card` surface on the dialog. Do not change the global popover token, theme colors, or add a pure-black dialog override.
- Remove backdrop blur from both the dialog and its outside overlay. Dim the outside content with `bg-black/30` in both themes.
- Preserve the existing subtle token border, use a restrained shadow, and retain rounded corners, spacing and responsive bounds. The input remains transparent inside the opaque dialog.
- Preserve all keyboard handlers, search scope, actions, navigation, deletion confirmation/error behavior, IPC and dialog semantics. No unrelated accessibility refactor.
- Code changes are limited to `CommandPalette.tsx`; existing palette tests may change only if necessary. No changes to CSS tokens, locales, editors, board, sessions, root dist, launchers or user data. No Cargo, native build, server, commit or push.

## References accepted by the parent

- [Juicebox: solid grouped palette](https://mobbin.com/screens/84169c57-5cd6-4495-bb71-93d37266f4c4)
- [Remote: dimmed background](https://mobbin.com/screens/2c863fcf-aab8-4a14-a85d-c6839d1b40f8)
- [Vapi: opaque dark surface](https://mobbin.com/screens/593d7acd-2e16-4365-bcd6-02ce52f48f3b)

These screens were examined by the parent. Reuse their surface hierarchy, keeping Coxinha tokens and typography.

## Verification and evidence

Run the existing focused palette suites, TypeScript and scoped Prettier. Do not add unit tests that merely repeat CSS class names. Store baseline files, exact incremental patch, hashes and verification report under `target/opaque-search-20261025/r1`.

Parent browser acceptance remains pending: measure computed dialog alpha of 1 and absent backdrop blur, inspect the palette over a busy board at 800px and 1280px in light and dark themes, and verify rounded viewport corners. Existing functional tests cover retained actions and keyboard behavior; they do not prove visual or native acceptance. The parent owns spec indexing, review and integration with the board/sidebar work.
