/** Chord text as the table writes it: pure parsing, matching and platform form. */
export type Chord = { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string };

const SYMBOL = /^[^\p{L}\p{N}]$/u;

export function parseChord(text: string): Chord {
  const parts = text.split('+');
  const key = parts.pop() ?? '';
  const has = (name: string) => parts.includes(name);
  return {
    mod: has('Mod'),
    ctrl: has('Ctrl'),
    alt: has('Alt'),
    shift: has('Shift'),
    meta: has('Super') || has('Cmd'),
    key,
  };
}

const eventKey = (key: string) => (key === 'Space' ? ' ' : key).toLowerCase();

/** AltGr types characters: on Windows it reports as Ctrl+Alt, which is not a chord. */
export function matchesChord(text: string, event: KeyboardEvent) {
  const chord = parseChord(text);
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  const ctrl = event.ctrlKey && !altGraph;
  const alt = event.altKey && !altGraph;
  if (eventKey(chord.key) !== event.key?.toLowerCase()) return false;
  if (alt !== chord.alt) return false;
  if (chord.mod ? !(ctrl || event.metaKey) : ctrl !== chord.ctrl || event.metaKey !== chord.meta)
    return false;
  // A symbol's Shift belongs to the layout: "?" is Shift+/ on some keyboards only.
  return SYMBOL.test(chord.key) || event.shiftKey === chord.shift;
}

export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const NAMES: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↵',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};
const MAC_MODS: Record<string, string> = {
  Mod: '⌘',
  Cmd: '⌘',
  Super: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
};

/** "Mod+K" as the keyboard in front of the user names it: Ctrl+K, or ⌘K on a Mac. */
export function formatChord(text: string, mac = isMac()) {
  const parts = text.split('+');
  const key = parts.pop() ?? '';
  const name = mac && key === 'Backspace' ? '⌫' : (NAMES[key] ?? key);
  if (mac) return parts.map((part) => MAC_MODS[part] ?? part).join('') + name;
  return [...parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)), name].join('+');
}

/** The same chord for `aria-keyshortcuts`, which names keys as the DOM does. */
export function ariaChord(text: string, mac = isMac()) {
  return text
    .split('+')
    .map((part) =>
      part === 'Mod'
        ? mac
          ? 'Meta'
          : 'Control'
        : part === 'Ctrl'
          ? 'Control'
          : part === 'Super' || part === 'Cmd'
            ? 'Meta'
            : part
    )
    .join('+');
}

const CODE_KEY = /^(?:Key([A-Z])|Digit(\d)|(F\d{1,2}))$/;
const NAMED_CODES = new Set([
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Period',
  'Comma',
  'Slash',
  'Semicolon',
  'Quote',
  'Minus',
  'Equal',
  'Backquote',
  'Backslash',
  'BracketLeft',
  'BracketRight',
]);
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'Super']);

export type CapturedChord =
  | { kind: 'waiting' }
  | { kind: 'needsModifier' }
  | { kind: 'unsupported' }
  | { kind: 'chord'; chord: string };

/**
 * A pressed key as the chord the global-shortcut plugin parses. It reads the
 * physical key, so a chord means the same on every layout.
 */
export function captureChord(event: KeyboardEvent): CapturedChord {
  if (MODIFIER_KEYS.has(event.key)) return { kind: 'waiting' };
  const match = CODE_KEY.exec(event.code);
  const key = match ? (match[1] ?? match[2] ?? match[3]) : NAMED_CODES.has(event.code) ? event.code : null;
  if (!key) return { kind: 'unsupported' };
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return { kind: 'needsModifier' };
  const mods = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Super',
  ].filter(Boolean);
  return { kind: 'chord', chord: [...mods, key].join('+') };
}
