/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../../locales/areas/shortcuts.en.json';
import ptBR from '../../locales/areas/shortcuts.pt-BR.json';
// @ts-expect-error A plain Node tool, without types.
import { PROBES } from '../../../tools/ui-preview/shortcutProbes.mjs';
import { SHORTCUTS } from './table';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(join(root, 'src'))
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/harness/.test(path))
  .map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'),
    code: readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1'),
  }));
const locales = walk(join(root, 'src/locales'))
  .filter((path) => path.endsWith('.json'))
  .map((path) => ({ path: relative(root, path), code: readFileSync(path, 'utf8') }));

const offenders = (pattern: RegExp, allowed: string[] = []) =>
  sources.filter(({ path, code }) => pattern.test(code) && !allowed.includes(path)).map((f) => f.path);

describe('the table is the only source of key handling', () => {
  it('has the one keydown listener, in the registry', () => {
    expect(
      offenders(/addEventListener\(\s*['"`]key(down|up|press)/, ['src/lib/shortcuts/registry.ts'])
    ).toEqual([]);
    expect(offenders(/\.onkey(down|up|press)\s*=/)).toEqual([]);
  });

  it('declares every file with an element key handler, and only those', () => {
    const handlers = sources
      .filter(({ code }) => /\bonKey(Down|Up|Press)(Capture)?\s*[=:]/.test(code))
      .map((file) => file.path)
      .sort();
    const declared = [
      ...new Set(SHORTCUTS.flatMap((entry) => ('elements' in entry ? entry.elements : []))),
    ].sort();
    expect(handlers).toEqual(declared);
  });

  it('leaves no key library or hand-rolled editor keymap outside the table', () => {
    expect(offenders(/useHotkeys|addKeyboardShortcuts|handleKeyDown\s*[:(]/)).toEqual([]);
  });

  it('every listener shortcut has its handler, and only table ids reach useShortcut', () => {
    const used = new Set(
      sources.flatMap(({ code }) =>
        [...code.matchAll(/useShortcut\(\s*'([^']+)'/g)].map((match) => match[1])
      )
    );
    const listeners = SHORTCUTS.filter((entry) => entry.owner === 'listener').map((e) => e.id);
    expect([...used].sort()).toEqual([...listeners].sort());
  });

  it('every system shortcut has a default equal to the Rust config', () => {
    const rust = readFileSync(join(root, 'shared/src/lib.rs'), 'utf8');
    for (const entry of SHORTCUTS.filter((item) => item.scope === 'system')) {
      const field = entry.id.replace('system.', '');
      expect(rust, entry.id).toContain(`${field}: "${entry.keys[0]}".into()`);
    }
  });

  it('no two entries of a scope share a chord through the listener', () => {
    const seen = new Set<string>();
    for (const entry of SHORTCUTS.filter((item) => item.owner === 'listener')) {
      for (const key of entry.keys) {
        const slot = `${entry.scope}/${key}`;
        expect(seen.has(slot), slot).toBe(false);
        seen.add(slot);
      }
    }
  });

  it('every entry says what it does in both languages', () => {
    const lookup = (catalog: object, key: string) =>
      key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], catalog);
    const all = (lng: string) => ({
      ...JSON.parse(readFileSync(join(root, `src/locales/${lng}.json`), 'utf8')),
      ...JSON.parse(readFileSync(join(root, `src/locales/areas/people.${lng}.json`), 'utf8')),
      ...(lng === 'en' ? en : ptBR),
    });
    for (const lng of ['en', 'pt-BR'])
      for (const entry of SHORTCUTS)
        expect(lookup(all(lng), entry.label), `${lng} ${entry.label}`).toBeTypeOf('string');
    expect(Object.keys(en.shortcuts.actions).sort()).toEqual(
      Object.keys(ptBR.shortcuts.actions).sort()
    );
  });
});

describe('the table is the only source of hints', () => {
  const CHORD_TEXT = /\b(Ctrl|Cmd|Control|Alt|Shift|Super|Win)\s*\+\s*[\w.,]|[⌘⌥⌃⇧⌫]/;
  const ALLOWED = ['src/lib/shortcuts/table.ts', 'src/lib/shortcuts/chords.ts'];

  it('no source spells a chord', () => {
    expect(offenders(CHORD_TEXT, ALLOWED)).toEqual([]);
  });

  it('no locale spells a chord', () => {
    expect(locales.filter(({ code }) => CHORD_TEXT.test(code)).map((f) => f.path)).toEqual([]);
  });

  it('detects the Mac in one place', () => {
    expect(offenders(/navigator\.platform/, ['src/lib/shortcuts/chords.ts'])).toEqual([]);
  });

  it('keeps aria-keyshortcuts and kbd text out of literals', () => {
    expect(offenders(/aria-keyshortcuts="/)).toEqual([]);
    expect(offenders(/<kbd[^>]*>\s*[A-Za-z↑↓←→↵]/)).toEqual([]);
  });
});

describe('pnpm test:shortcuts covers the table', () => {
  const ids = SHORTCUTS.map((entry) => entry.id);

  it('has a probe for every shortcut, so a new one cannot ship untested', () => {
    expect(ids.filter((id) => !(id in PROBES))).toEqual([]);
  });

  it('has no probe for a shortcut that is gone', () => {
    expect(Object.keys(PROBES).filter((id) => !(ids as string[]).includes(id))).toEqual([]);
  });
});

it('nothing asks through window dialogs, which the dialog plugin turns async', () => {
  expect(offenders(/\bwindow\.(confirm|alert|prompt)\(/)).toEqual([]);
  expect(offenders(/(^|[^.\w])(confirm|alert|prompt)\(['"`]/m)).toEqual([]);
});
