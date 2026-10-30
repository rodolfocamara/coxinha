/** Exact first-line IPC codes; diagnostic prose never determines classification. */
const knownErrors = {
  note_file_missing_or_moved: {
    recovery: 'noteRecovery.missingOrMoved',
    rebuild: 'settings.rebuildErrors.missingOrMoved',
  },
  note_file_changed_externally: {
    recovery: 'noteRecovery.changedExternally',
    rebuild: 'settings.rebuildErrors.changedExternally',
  },
  note_file_invalid_metadata: {
    recovery: 'noteRecovery.invalidMetadata',
    rebuild: 'settings.rebuildErrors.invalidMetadata',
  },
  note_file_identity_conflict: {
    recovery: 'noteRecovery.identityConflict',
    rebuild: 'settings.rebuildErrors.identityConflict',
  },
} as const;

function messageOf(error: unknown): string | null {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : null;
}
function codeOf(error: unknown): keyof typeof knownErrors | null {
  const firstLine = messageOf(error)?.split(/\r?\n/, 1)[0];
  return firstLine && Object.hasOwn(knownErrors, firstLine)
    ? (firstLine as keyof typeof knownErrors)
    : null;
}
export function noteFileRecoveryKey(error: unknown) {
  const code = codeOf(error);
  return code ? knownErrors[code].recovery : null;
}
export function noteFileRebuildKey(error: unknown) {
  const code = codeOf(error);
  return code ? knownErrors[code].rebuild : null;
}
/** Plain text only. Remove the transport code, including standalone repeated markers. */
export function noteFileDiagnosticDetail(error: unknown): string | null {
  const code = codeOf(error);
  if (!code) return null;
  const detail = messageOf(error)!
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line !== code)
    .join('\n');
  return detail || null;
}
export function isMissingNoteFile(error: unknown): boolean {
  return noteFileRecoveryKey(error) === 'noteRecovery.missingOrMoved';
}

/** Deletion refusals are operation-specific, not file recovery/rebuild failures. */
export function noteDeletionErrorKey(error: unknown) {
  if (messageOf(error)?.split(/\r?\n/, 1)[0] === 'session_note_delete_requires_detach')
    return 'editor.sessionNoteDeleteRequiresDetach';
  return noteFileRecoveryKey(error);
}
