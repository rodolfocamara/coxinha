/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const order = '@layer theme, base, components, utilities;';

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') && name !== 'index.css' ? [path] : [];
  });
}

it('keeps every component and feature stylesheet below Tailwind utilities', () => {
  const files = cssFiles(src);
  expect(files.length).toBeGreaterThan(5);
  for (const file of files) {
    const css = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    // Whichever stylesheet loads first fixes the layer order. Declaring it keeps
    // Tailwind's preflight (base) below components even when a component
    // imports its CSS before main.tsx imports index.css.
    expect(css.startsWith(order), file).toBe(true);
    const rest = css.slice(order.length).replace(/^\s*(@import [^;]+;\s*)*/, '');
    // Unlayered rules beat every layered utility regardless of specificity.
    expect(rest.startsWith('@layer components {'), file).toBe(true);
    expect(rest.endsWith('}'), file).toBe(true);
    // @import is only valid before rules; inside a block it leaks raw into the bundle.
    expect(rest.includes('@import'), file).toBe(false);
  }
});
