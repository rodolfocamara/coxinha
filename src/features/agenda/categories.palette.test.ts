import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { OUTLOOK_PRESETS } from './categories';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'categories.css'),
  'utf8'
);

const block = (selector: string) => {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf('}', start));
};
const values = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/--outlook-cat-(\d+(?:-bg)?):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]])
  );

it('defines a mark and a fill for every preset in both themes', () => {
  for (const theme of [values(block(':root {')), values(block("[data-theme='dark'] {"))]) {
    for (const [index] of OUTLOOK_PRESETS.entries()) {
      expect(theme[String(index)]).toMatch(/^#/);
      expect(theme[`${index}-bg`]).toMatch(/^#/);
    }
  }
});

it('uses the new Outlook values measured on the owner calendar', () => {
  const light = values(block(':root {'));
  const dark = values(block("[data-theme='dark'] {"));
  // Steel (preset10): Outlook's bar is Fluent steel and its dark fill steel shade30.
  expect(light['10']).toBe('#005b70');
  expect(dark['10-bg']).toBe('#00333f');
  // Brown (preset2) is Fluent peach in the new Outlook.
  expect(light['2']).toBe('#ff8c00');
});
