# 0080: Linux native audio transport

Status: bounded implementation; native WebKitGTK acceptance pending.

## Problem and scope

WebKitGTK/GStreamer rejects native `asset://` media with `No URI handler
implemented for asset`. The backend already verifies individual WAV files, but
asset authorization does not install a GStreamer handler. Adding `asset` to a
protocol environment allowlist does not solve this. Evidence and upstream source
are retained in `target/speaker-workspace-20261025/integration-r1/native-voice/`.

Preserve the existing players, excerpt hook and curation UI. Windows keeps scoped
asset playback. Linux uses HTTP exclusively bound to `127.0.0.1`, ephemeral port.
This explicitly authorized local transport does not allow external requests, LAN
listening, filesystem discovery, or wider asset permissions.

## Authorization and DTO

- `library_detail`, `library_recover` and `library_import_audio` preserve
  `audio: Record<track, string> | null`. Linux values are capabilities of the form
  `http://127.0.0.1:<port>/audio/<64 lowercase hex>.wav`, without local paths.
  No IPC grants arbitrary paths and no HTTP handler opens a request path.
- Only canonical backend-verified details grant files. Authorization opens a
  regular, non-symlink file, compares inode identity and verifies SHA-256 and WAV
  metadata against its manifest on the open descriptor. Playback reads that
  descriptor with positioned IO, preserving concurrent Range offsets even if
  the pathname is subsequently renamed/replaced. Raw files remain immutable by
  contract; defending against a local process writing the same inode is outside
  this capability boundary.
- Tokens contain 244 random bits from two UUID v4 values, are neither persisted
  nor logged. Up to 256 live grants are reused by inode/hash and expire after
  24 hours. Expired/revoked grants cannot start a request. Revocation stops
  transfer between writes, including readiness waits polled every 100 ms;
  stop cancels every connection and clears grants.
- The frontend remembers only sources returned by the three authorized commands.
  It validates literal loopback URL shape and pins the server authority, passes
  those URLs unchanged, and rejects unknown URLs/paths. Absolute legacy paths
  returned by the trusted backend retain scoped asset conversion on platforms
  using asset playback. No player/hook or curation DTO changes are required.

## HTTP and resource limits

- HTTP/1.1 GET/HEAD only, exactly one Host equal to `127.0.0.1:<port>`, literal
  capability path only. Reject query, fragment, escapes, traversal, absolute
  request targets, duplicate headers, request bodies and transfer encoding.
- Origin is optional for native media requests without Origin. If present it
  must exactly match `tauri://localhost` or, in debug builds, the configured dev
  frontend origin. Reject `null` and external origins. CORS reflects only an
  allowed origin without credentials. Literal Host prevents DNS rebinding;
  capability possession remains necessary even for clients without Origin.
- Return `audio/wav`, `Accept-Ranges: bytes`, Content-Length, `no-store`, `nosniff`,
  connection close, no redirects/cookies. Full GET returns 200. One closed/open/
  suffix Range returns 206. Invalid, multiple, unsatisfiable or overflowing ranges
  return 416 with `Content-Range: bytes */<length>`. HEAD ignores Range and has
  no response body, per HTTP semantics. If-Range cannot match because this
  no-store transport issues no validators, so it falls back to a full 200.
- At most 8 active connections, 8192 header bytes, 2 seconds for a complete
  request header and response header write, 24 hours per authorized request
  body (matching grant lifetime). Authorized bodies have no 2-second write limit.
  A total five-minute GET deadline would truncate long recordings streamed at
  playback speed; active transfers must outlive the maximum PCM RIFF duration
  of approximately 12.4 hours. WebKit's native media source pauses downloading
  between its 20 MiB high and 2 MiB low queue thresholds, so an authorized
  consumer may legitimately stop reading for minutes or pause playback.
  `WebKitWebSourceGStreamer.cpp` in the retained upstream research documents
  those thresholds. A 2-second body write deadline was proven wrong by a RED
  real-HTTP test: the same socket resumed after 2.5 seconds but received only
  2,621,440 of 8,388,652 WAV bytes. The old source, spec, and failing log remain
  under `body-backpressure-red/` in this round's evidence directory.
  Body writes use `writable()` plus `try_write()` with a counted offset; only
  readiness waits are polled, never a partially completed `write_all` retried.
  Revocation/expiry are checked before and after waits; stop aborts all tasks.
  Up to 8 authorized paused consumers can retain all slots until resume,
  cancellation, revocation or expiry. A ninth connection is closed; no other
  library worker/autosave/IPC work shares these slots.
  No unbounded queue. A 64 KiB
  file buffer per connection avoids loading entire recordings into memory.
- A dedicated IO runtime owns the listener and network tasks. Grant verification
  runs on a blocking task outside the library worker and IPC runtime. Registry
  locks are short and never span network IO. Stop cancels tasks, closes sockets
  and joins its IO thread without callbacks to library, storage or the UI.

## Ownership and lifecycle

New `src-tauri/src/native_audio*` modules, small integrations in `lib.rs`,
`library/commands.rs`, `desktop/shutdown.rs`, frontend `library.ts`, and dedicated
new tests. One existing SessionRecording test fixture uses real capability URLs
instead of relative filenames, coordinated with the parent. Do not edit frozen
R5 UI/hooks/locales, R3 backend curation, or previous
speaker/core/integration snapshots.

RAII Drop explicitly cancels and joins when the state is destroyed. Normal Tauri
exit can bypass state Drop, so `complete_exit` explicitly calls stop on a blocking
runtime task after library finalization and all abortable exit decisions, before
`commit_shutdown`/`app.exit`. An aborted close keeps audio running. Explicit discard
also stops audio only when exit has already been selected. The join does not
wait for UI, library, storage or network clients. Forced process termination is
covered only by OS socket/descriptor cleanup, not Rust Drop guarantees.

## Acceptance and evidence

Hermetic tests cover real HTTP WAV bytes and seek, concurrent Range requests on
the SAME grant with distinct offsets, full GET/HEAD/suffix/416, origin/Host/token/
traversal/encoded path attacks, oversize headers, slow clients, bounded grants,
revocation/expiry and explicit stop/Drop with pending clients. Renaming/replacing
a path after grant proves stable descriptor reads; invalid files are never
granted. Canonical detail/recover/import boundary tests reject unknown/private
paths and preserve library worker shutdown independence.
The GREEN backpressure regression resumes the same authorized socket after
more than 2 seconds and requires the complete WAV byte for byte, including
every byte across partial writes. Header slowloris still expires after 2 seconds.

The parent performs actual native WebKitGTK playback acceptance with a private
profile. HTTP byte tests and shutdown unit tests do not prove native sound output
or execution of the full Tauri close UI flow.

Baseline/delta/pins/results belong to `target/native-audio-20261025/r1/`. The initial
Portuguese spec is retained as `spec0080-initial.md`, with the English contract as
a subsequent documented delta. No commit, push, installation or launcher changes.
