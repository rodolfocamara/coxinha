# ADR 0020: Save and close without routine confirmation

Date: 2026-10-25. Status: accepted by explicit user request; implemented with automated and
isolated browser evidence. Native Linux integration and Windows acceptance pending.

The user requested that closing Coxinha save pending changes and exit directly.
This supersedes only the mandatory initial exit confirmation in ADR 0019.
Window close and tray Quit continue to share a durable save/stop handshake.
Successful shutdown does not ask for confirmation and is not minimize-to-tray.

Failures and delayed operations remain recoverable. Never infer successful saving
from a timer or discard edits silently. Use a centered, accessible application
recovery dialog when the frontend responds; retain a parented native emergency
fallback for an unresponsive frontend. The storage shutdown barrier, raw recording
preservation and explicit warning before discard remain mandatory.

See spec 0074 for acceptance. Other board, notes and Outlook decisions in ADR 0019
remain unchanged.


Implementation separates UI receipt from durable completion and correlates flush
and recovery responses to the single active shutdown. A delayed save does not
unlock editing or authorize discard. The healthy recovery UI is a viewport-fixed
portal with an inert background, contained focus and Escape/Keep open. Native
emergency parenting is best effort; compositor/OS placement is outside the app's
control. Existing storage terminal commitment and raw-preserving library shutdown
are reused without changing their contracts. See spec 0074 and its R1 evidence
for timings, commands and validation boundaries.
