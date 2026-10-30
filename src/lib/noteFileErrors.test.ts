import { expect, it } from 'vitest';
import {
  noteDeletionErrorKey,
  noteFileDiagnosticDetail,
  noteFileRebuildKey,
  noteFileRecoveryKey,
} from './noteFileErrors';

it.each([
  ['note_file_identity_conflict', 'settings.rebuildErrors.identityConflict'],
  ['note_file_invalid_metadata', 'settings.rebuildErrors.invalidMetadata'],
  ['note_file_missing_or_moved', 'settings.rebuildErrors.missingOrMoved'],
  ['note_file_changed_externally', 'settings.rebuildErrors.changedExternally'],
])('extracts plain detail after %s and selects rebuild-specific guidance', (code, key) => {
  const detail = 'notes/<b>literal</b>.md: cause\nnotes/second.md';
  expect(noteFileDiagnosticDetail(`${code}\n${detail}`)).toBe(detail);
  expect(noteFileDiagnosticDetail(new Error(`${code}\r\n${detail.replaceAll('\n', '\r\n')}`))).toBe(
    detail
  );
  expect(noteFileDiagnosticDetail(`${code}\n${code}\n${detail}\n${code}`)).toBe(detail);
  expect(noteFileRebuildKey(`${code}\n${detail}`)).toBe(key);
  expect(noteFileDiagnosticDetail(code)).toBeNull();
  expect(noteFileDiagnosticDetail(`${code}\n`)).toBeNull();
});

it.each([
  'unknown\nnote_file_identity_conflict',
  'disk full: note_file_invalid_metadata',
  '__proto__\nnotes/a.md',
  'note_file_identity_conflict \nnotes/a.md',
  { message: 'note_file_identity_conflict\nnotes/a.md' },
  null,
  undefined,
  42,
])('does not classify or extract details from unknown input %s', (error) => {
  expect(noteFileRecoveryKey(error)).toBeNull();
  expect(noteFileRebuildKey(error)).toBeNull();
  expect(noteFileDiagnosticDetail(error)).toBeNull();
});

it('classifies the exact session deletion refusal only for the deletion operation', () => {
  const code = 'session_note_delete_requires_detach';
  for (const error of [code, new Error(`${code}\r\nprotected ownership`)]) {
    expect(noteDeletionErrorKey(error)).toBe('editor.sessionNoteDeleteRequiresDetach');
    expect(noteFileRecoveryKey(error)).toBeNull();
    expect(noteFileRebuildKey(error)).toBeNull();
  }
  for (const error of [`prefix ${code}`, `${code} `, `unknown\n${code}`, { message: code }])
    expect(noteDeletionErrorKey(error)).toBeNull();
  expect(noteDeletionErrorKey('note_file_identity_conflict')).toBe('noteRecovery.identityConflict');
});
