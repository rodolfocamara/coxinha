import { useShortcut } from '../../lib/shortcuts';

type Actions = {
  toggleMenu: () => void;
  copyLink: () => void;
  duplicate: () => void;
};

/** The shortcuts the note menu advertises. */
export function useNoteShortcuts(actions: Actions) {
  useShortcut('note.menu', () => actions.toggleMenu());
  useShortcut('note.copyLink', () => actions.copyLink());
  useShortcut('note.duplicate', () => actions.duplicate());
}
