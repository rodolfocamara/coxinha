# Spec 0061: Usable desktop, activity board, and Outlook agenda

Status: implemented and locally validated, 2026-10-23; native desktop, Windows, hardware and live OAuth acceptance pending. User explicitly replaces the old close-to-tray behavior.

## Scope and acceptance

1. Window close and tray Quit use one visible exit flow. Cancel preserves the session; minimize to tray is explicit. Exit flushes pending note writes and safely finalizes recording before stopping. No fixed sleep is treated as proof of saving. Errors keep the app open with a retry path. A crashed frontend must not trap the user without a native fallback.
2. Bounded local diagnostic files capture sanitized lifecycle and frontend error categories with build/session identification. Never log note bodies, transcripts, tokens, attendees or voice embeddings. Show the log location and a recovery path after errors.
3. Notes open in one persistent infinite activity board: pan/zoom, colored areas, note cards, explicit dependency connections, accessible editing controls, existing Markdown note editor. Existing notes/data stay intact. Board geometry is canonical sidecar data, saved atomically with version/conflict checks; not a rebuildable cache. Removing a card/connection does not delete its note. Save failures are visible and do not silently discard edits.
4. Real agenda replaces production fixtures. Outlook integration is read-only and explicitly connected by the user, using a Coxinha-owned public OAuth client, least privilege and no embedded secret. Tokens stay in the OS credential store, never plaintext fallback. Offline cached events show freshness; dates/recurrences retain occurrence identity. Attendees are review candidates, never proof of attendance or voice identity. No tenant/consent configuration is changed by this work.
5. Meeting recording status, source selection, stop/save and processing feedback stay visible and actionable. Automatic recording is opt-in only, with device preflight, duplicate prevention and clear cancellation. No actual recording is started during implementation without explicit user action; synthetic private-daemon tests are allowed.
6. Mobbin references inform layout only; reuse Coxinha tokens, no external branding. No network without explicit connection. Linux and Windows build/hardware acceptance remain distinct.

## Delivery gates

Test close cancel/flush/failure, root error recovery, persisted board reload/conflict/malformed data, calendar offline/auth/cancellation/recurrence and no auto-record by default. Run current-head frontend tests/typecheck/build and targeted Rust tests. Independent Fable review; Sol 6.1 implementation, Gemini inventory. Native hardware, live Outlook authorization and user acceptance must be reported separately from tests.
