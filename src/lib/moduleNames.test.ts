import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// Windows resolves `./BoardNodes` and `./boardNodes` to the same file, so two
// modules whose import paths differ only in case break the Windows build.
it('has no import paths that differ only in case', () => {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const file of files(src)) {
    const specifier = relative(src, file).replace(/\.(d\.ts|tsx?|jsx?)$/, '');
    if (specifier === relative(src, file)) continue;
    const key = specifier.toLowerCase();
    const other = seen.get(key);
    if (other && other !== specifier) clashes.push(`${other} / ${specifier}`);
    seen.set(key, specifier);
  }
  expect(clashes).toEqual([]);
});
