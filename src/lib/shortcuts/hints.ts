import { ariaChord, formatChord } from './chords';
import { shortcutEntry, type ShortcutId } from './table';

/** The hint a menu or tooltip shows: the shortcut's first chord, in the platform's form. */
export const shortcutHint = (id: ShortcutId) => formatChord(shortcutEntry(id).keys[0]);

/** Every chord of a shortcut, for the lists. */
export const shortcutHints = (id: ShortcutId) => shortcutEntry(id).keys.map((key) => formatChord(key));

/** `aria-keyshortcuts` of a shortcut. */
export const shortcutAria = (id: ShortcutId) =>
  shortcutEntry(id)
    .keys.map((key) => ariaChord(key))
    .join(' ');
