import { describe, expect, it } from 'vitest';
import { ariaChord, captureChord, formatChord, matchesChord } from './chords';

const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('matchesChord', () => {
  it('takes Ctrl or Cmd for Mod, and letters in either case', () => {
    expect(matchesChord('Mod+K', press({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(matchesChord('Mod+K', press({ key: 'k', metaKey: true }))).toBe(true);
    expect(matchesChord('Mod+K', press({ key: 'K', ctrlKey: true }))).toBe(true);
    expect(matchesChord('Mod+K', press({ key: 'k' }))).toBe(false);
  });

  it('wants exactly the modifiers it names', () => {
    expect(matchesChord('Mod+D', press({ key: 'd', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesChord('Mod+D', press({ key: 'd', ctrlKey: true, altKey: true }))).toBe(false);
    expect(matchesChord('T', press({ key: 't', ctrlKey: true }))).toBe(false);
    expect(matchesChord('T', press({ key: 'T', shiftKey: true }))).toBe(false);
    expect(matchesChord('1', press({ key: '1', altKey: true }))).toBe(false);
  });

  it('leaves a symbol its Shift, which belongs to the keyboard layout', () => {
    expect(matchesChord('?', press({ key: '?', shiftKey: true }))).toBe(true);
    expect(matchesChord('?', press({ key: '?' }))).toBe(true);
    expect(matchesChord('Mod+.', press({ key: '.', ctrlKey: true }))).toBe(true);
  });

  it('does not take AltGr for Ctrl+Alt', () => {
    const altGr = press({ key: '?', ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(matchesChord('?', altGr)).toBe(true);
    expect(matchesChord('Ctrl+Alt+?', altGr)).toBe(false);
  });

  it('names the space bar', () => {
    expect(matchesChord('Space', press({ key: ' ' }))).toBe(true);
  });

  it('ignores a key event without a key, as autofill sends', () => {
    expect(matchesChord('Mod+K', new Event('keydown') as KeyboardEvent)).toBe(false);
  });
});

describe('formatChord', () => {
  it.each([
    ['Mod+K', 'Ctrl+K', '⌘K'],
    ['Mod+.', 'Ctrl+.', '⌘.'],
    ['Mod+Backspace', 'Ctrl+Backspace', '⌘⌫'],
    ['Ctrl+Alt+T', 'Ctrl+Alt+T', '⌃⌥T'],
    ['Super+Shift+N', 'Super+Shift+N', '⌘⇧N'],
    ['Escape', 'Esc', 'Esc'],
    ['ArrowUp', '↑', '↑'],
    ['Enter', '↵', '↵'],
    ['1', '1', '1'],
  ])('%s is %s, or %s on a Mac', (chord, other, mac) => {
    expect(formatChord(chord, false)).toBe(other);
    expect(formatChord(chord, true)).toBe(mac);
  });

  it('names keys for aria-keyshortcuts', () => {
    expect(ariaChord('Mod+K', false)).toBe('Control+K');
    expect(ariaChord('Mod+K', true)).toBe('Meta+K');
    expect(ariaChord('Ctrl+Alt+Y', false)).toBe('Control+Alt+Y');
  });
});

describe('captureChord', () => {
  it('reads the physical key, so the chord is the same on any layout', () => {
    expect(captureChord(press({ key: 'т', code: 'KeyN', ctrlKey: true, altKey: true }))).toEqual({
      kind: 'chord',
      chord: 'Ctrl+Alt+N',
    });
    expect(captureChord(press({ key: '1', code: 'Digit1', altKey: true, shiftKey: true }))).toEqual(
      { kind: 'chord', chord: 'Alt+Shift+1' }
    );
    expect(captureChord(press({ key: 'F5', code: 'F5', metaKey: true }))).toEqual({
      kind: 'chord',
      chord: 'Super+F5',
    });
  });

  it('waits through modifiers and refuses what cannot be global', () => {
    expect(captureChord(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toEqual({
      kind: 'waiting',
    });
    expect(captureChord(press({ key: 'y', code: 'KeyY' }))).toEqual({ kind: 'needsModifier' });
    expect(captureChord(press({ key: 'Y', code: 'KeyY', shiftKey: true }))).toEqual({
      kind: 'needsModifier',
    });
    expect(captureChord(press({ key: 'x', code: 'IntlRo', ctrlKey: true }))).toEqual({
      kind: 'unsupported',
    });
  });
});
