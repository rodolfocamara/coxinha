# ADR 0019: Explicit exit and persistent activity board

Date: 2026-10-23. Status: accepted for implementation by user request.

The mandatory initial confirmation below is superseded by [ADR 0020](0020-save-and-close.md). The durable handshake and recovery requirements remain in effect.

The old silent close-to-tray rule is superseded. Window close and tray Quit must expose one exit confirmation and save/stop handshake, with explicit minimize and cancel. Never infer durable completion from a timer. Existing recordings and edits must survive a cancelled or failed exit.

Notes remain Markdown. A versioned atomic sidecar stores board geometry, colors, areas and dependency edges referencing note UUIDs. It is canonical user-authored data and must be backed up with the vault; deleting the index must not remove it. Removing a visual item never deletes Markdown notes. Reuse an established canvas component after checking its license; keep board operations local.

Outlook metadata is private cached input, linked by account and occurrence identity. Invitees only populate candidate names. OAuth is explicit with a configured application owned by the installation operator; no third-party enterprise application's grants are reused.
