import { describe, expect, it } from 'vitest';
import en from './en.json';

/**
 * Invariant: every interactive UI string must go through i18n.
 * This test anchors the bundled English catalog so that removing
 * or renaming a key we actually render will fail CI.
 */
describe('en locale catalog', () => {
  const requiredKeys: Array<[string, string[]]> = [
    ['brand', ['name']],
    ['nav', ['notes', 'agenda', 'meetings', 'settings']],
    ['sidebar', ['newNoteButton', 'recentHeading', 'emptyState', 'untitled']],
    ['empty', ['noNoteSelected']],
    ['a11y', ['mainNavigation', 'noteList', 'newNote']],
  ];

  it.each(requiredKeys)('has non-empty strings under "%s"', (group, keys) => {
    const bag = (en as Record<string, Record<string, unknown>>)[group];
    expect(bag, `missing group "${group}"`).toBeTypeOf('object');
    for (const key of keys) {
      const value = bag[key];
      expect(value, `${group}.${key} is missing`).toBeTypeOf('string');
      expect(
        (value as string).trim().length,
        `${group}.${key} is empty`
      ).toBeGreaterThan(0);
    }
  });
});
