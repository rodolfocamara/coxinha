import { useEffect, useState } from 'react';
import type { NoteFont } from './NoteActionsMenu';
import {
  PREF_FONT_KEY,
  PREF_FULLWIDTH_KEY,
  PREF_SMALL_KEY,
  readPrefBool,
  readPrefString,
} from './notePrefs';

/** How notes look, remembered across notes and runs. */
export function useNotePrefs() {
  const [font, setFont] = useState<NoteFont>(() =>
    readPrefString<NoteFont>(PREF_FONT_KEY, ['default', 'serif', 'mono'], 'default')
  );
  const [smallText, setSmallText] = useState(() => readPrefBool(PREF_SMALL_KEY, false));
  const [fullWidth, setFullWidth] = useState(() => readPrefBool(PREF_FULLWIDTH_KEY, false));
  useEffect(() => {
    window.localStorage.setItem(PREF_FONT_KEY, font);
  }, [font]);
  useEffect(() => {
    window.localStorage.setItem(PREF_SMALL_KEY, smallText ? '1' : '0');
  }, [smallText]);
  useEffect(() => {
    window.localStorage.setItem(PREF_FULLWIDTH_KEY, fullWidth ? '1' : '0');
  }, [fullWidth]);
  return { font, setFont, smallText, setSmallText, fullWidth, setFullWidth };
}
