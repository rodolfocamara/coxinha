import { expect, it } from 'vitest';
import { noteFileRecoveryKey, isMissingNoteFile } from './noteFileErrors';

it.each([
  ['note_file_identity_conflict', 'noteRecovery.identityConflict'],
  ['note_file_invalid_metadata', 'noteRecovery.invalidMetadata'],
  ['note_file_missing_or_moved', 'noteRecovery.missingOrMoved'],
  ['note_file_changed_externally', 'noteRecovery.changedExternally'],
])(
  'recognizes only first-line code %s with contextual detail in strings and Errors',
  (code, key) => {
    for (const separator of ['\n', '\r\n']) {
      const text = `${code}${separator}indexing notes/a.md: actionable cause`;
      expect(noteFileRecoveryKey(text)).toBe(key);
      expect(noteFileRecoveryKey(new Error(text))).toBe(key);
    }
    expect(isMissingNoteFile(`${code}\nnotes/a.md`)).toBe(code === 'note_file_missing_or_moved');
  }
);

it('never classifies unknown prose or a known code appearing after the first line', () => {
  for (const value of [
    'indexing notes/a.md: note_file_invalid_metadata',
    'unknown\nnote_file_identity_conflict',
    ' note_file_invalid_metadata\nnotes/a.md',
    { message: 'note_file_invalid_metadata\nnotes/a.md' },
    null,
  ])
    expect(noteFileRecoveryKey(value)).toBeNull();
});
