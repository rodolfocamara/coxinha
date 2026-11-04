import { useEffect, useRef } from 'react';

type Actions = {
  toggleMenu: () => void;
  copyLink: () => void;
  duplicate: () => void;
};

/** The shortcuts the note menu advertises. Ctrl or Cmd, so typing never reaches them. */
export function useNoteShortcuts(actions: Actions) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
      if (event.shiftKey || event.altKey) return;
      const run = {
        '.': latest.current.toggleMenu,
        l: latest.current.copyLink,
        d: latest.current.duplicate,
      }[event.key.toLowerCase()];
      if (!run) return;
      event.preventDefault();
      run();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
