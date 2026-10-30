# Spec 0074: Save and close without routine confirmation

- Status: implemented; automated/library and isolated browser checks passed.
  Parent-owned native Linux integration and Windows acceptance remain pending.
- Phase: desktop usability and durable lifecycle.
- Why: the user explicitly requested direct close after saving and reported the
  native confirmation appearing far from the application on Linux.
- Non-goals: silent data loss, close-to-tray, background recording after exit,
  schema changes, scheduled shutdown, or weakening the storage mutation barrier.

## Behavior

Window close and tray Quit initiate one shared save/stop protocol immediately.
There is no initial confirmation, minimize choice, or routine native dialog.
Wait for durable frontend save acknowledgements, recorder finalization and library
shutdown before committing terminal storage state and exiting. A timer alone is
never success. Repeated close requests cannot start competing shutdowns.

Normal successful close should be visually quiet. A longer operation may show a
brief localized saving indicator centered inside the application's viewport.
An active recording is finalized and saved; processing is interrupted through the
existing recoverable protocol. Do not silently lose a pending note, board edit,
attachment or raw recording because the user requested fewer prompts.

For actual save/finalization failure or a meaningful delay, offer Retry and Keep
open, and explicit warned discard only through the existing recovery semantics.
The normal interactive error dialog must be centered within the application,
including a moved or resized window, and keyboard accessible with contained focus.
Background editing stays locked during shutdown while recovery controls remain
operable. Cancel restores interaction. Stale responses cannot authorize exit.
If the frontend itself is unresponsive, a parented native emergency fallback is
acceptable; document compositor limitations instead of claiming universal placement.

## Implementation and validation

Preserve the terminal storage barrier, raw recovery, late flush acknowledgement,
reason whitelist and canonical note protections. Refactor desktop.rs if needed
rather than expanding an already long module. Update ADR 0019's obsolete routine
confirmation rule by reference to ADR 0020 and update CLAUDE.md accordingly.

Meaningful regression coverage: close success without any initial prompt; pending
save waits; permanent save failure remains recoverable; retry and cancel; delayed
ACK; repeated close; active capture finalization and failure; pending attachment;
terminal writes remain refused; centered recovery overlay/focus and keyboard use.
Use synthetic IPC/public temporary data and isolated Cargo targets. No default
native smoke suite or operator vault. Native Linux proof and Windows acceptance
are distinct from unit/browser checks. No unrequested app termination or restart.


## Implemented protocol

`request_exit` admits one active flow and starts flushing directly. The native
side retransmits the same request until `desktop_flush_started` acknowledges UI
receipt; only `desktop_flush_result` can report durable save completion. Recovery
uses a separate random recovery ID, an acknowledgement after the modal mounts,
and whitelisted actions. Both IDs must match the active request. Completed,
cancelled and superseded frontend requests ignore stale delivery.

The frontend waits for all three lifecycle listeners before acknowledging a
flush. Saving appears after 750 ms. After 30 seconds without a durable result,
native asks for in-app recovery; after 3 seconds without modal acknowledgement,
it offers the parented native emergency dialog. No deadline authorizes saving or
discard. Retry on an unfinished save retains that request and waits; a completed
failed flush can start a new attempt without unlocking the background. Successful
flush proceeds through the unchanged storage quiescence, recorder stop, library
shutdown and terminal commit. Native finalization is awaited, not force-killed.

The recovery portal is fixed to the viewport, outside the inert app root. Focus
stays in its buttons, Escape chooses Keep open, and cancellation restores the
previous focus only after the correlated native abort. Pointer/keyboard editing
remains blocked outside the portal. Explicit warned discard retains the existing
raw-preserving shutdown path. The emergency owner is best effort: the OS or
compositor determines actual native-dialog placement.

## R1 evidence, 2026-10-25

Artifacts: `target/save-and-close-20261025/r1/validation.md`, exact source/hash
manifests, before/after tree manifests and an incremental patch against the dirty
baseline. No commit, push, native launch, termination/restart or operator-data
access was performed.

- Frontend regressions were red against the old component and green after the
  change. Final focused lifecycle/persistence/contracts: 42 tests passed.
- Tauri library: `cargo test --offline --locked -p coxinha --lib --features
  local-processing`, 218 passed and one explicitly ignored. Private reflinked
  Cargo target, public ONNX Runtime 1.22.0, no native-smoke-tests feature.
  Existing finalization-failure/raw-preservation, saturated shutdown queue and
  terminal-write-barrier tests passed unchanged.
- Isolated frontend: frozen integration-r2 nonowned files plus exact lifecycle
  frontend files, 381 tests in 60 files; typecheck and production build passed.
  Concurrent calendar work is excluded from this integration claim.
- Browser: real lifecycle components and production CSS with synthetic IPC,
  measured viewport 1280x800. Modal centering within 1 CSS px, focus containment,
  Tab wrapping, Escape cancellation, focus restoration, delayed status, late ACK,
  retry lock and explicit warned discard passed. This does not prove native
  placement, physical audio, moved/resized native windows or Windows behavior.
