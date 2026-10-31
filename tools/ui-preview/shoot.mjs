#!/usr/bin/env node
/**
 * Visual check harness for spec 0096. Needs the Vite dev server
 * (`pnpm dev`, http://localhost:1420). Injects a mocked Tauri IPC with the
 * fixtures under ./fixtures, opens a route through the dev router handle and
 * writes a PNG.
 *
 *   node tools/ui-preview/shoot.mjs --route /meetings --name meetings \
 *     [--theme dark|light] [--state capture=recording,call=1] [--out /tmp/cx-ui]
 *     [--click "css selector"] [--wait 600] [--width 1280 --height 800] [--locale pt-BR]
 *
 * Prints unmocked IPC commands and page errors so missing fixtures are visible.
 */
import { chromium } from 'playwright';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return pairs;
  }, [])
);
const route = args.route ?? '/';
const name = args.name ?? (route.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'hoje');
const theme = args.theme ?? 'dark';
const out = args.out ?? '/tmp/cx-ui';
const base = process.env.COXINHA_URL ?? 'http://localhost:1420';
const state = Object.fromEntries(
  (args.state ?? '').split(',').filter(Boolean).map((kv) => {
    const [k, v] = kv.split('=');
    return [k, v === undefined ? true : v];
  })
);

// Newest locally installed Chromium; override with PW_CHROMIUM.
function chromiumPath() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    const exe = path.join(cache, b, 'chrome-linux64/chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const fixtureFiles = (await readdir(path.join(here, 'fixtures'))).filter((f) => f.endsWith('.js')).sort((a, b) => (a === 'base.js' ? -1 : b === 'base.js' ? 1 : a.localeCompare(b)));
const scripts = [
  `window.__cxState = ${JSON.stringify(state)};`,
  ...(await Promise.all(fixtureFiles.map((f) => readFile(path.join(here, 'fixtures', f), 'utf8')))),
  await readFile(path.join(here, 'mock-ipc.js'), 'utf8'),
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? chromiumPath() });
const page = await browser.newPage({
  viewport: { width: Number(args.width ?? 1280), height: Number(args.height ?? 800) },
  colorScheme: theme === 'light' ? 'light' : 'dark',
  locale: args.locale ?? 'pt-BR',
});
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
for (const script of scripts) await page.addInitScript(script);
await page.addInitScript((t) => localStorage.setItem('coxinha.themePref', t), theme);
await page.goto(base, { waitUntil: 'domcontentloaded' });
const ready = await page
  .waitForFunction(() => window.__coxinha?.router, null, { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
if (!ready) errors.push('router handle never appeared (app failed to boot?)');
if (ready && route !== '/') await page.evaluate((to) => window.__coxinha.router.navigate({ to }), route);
await page.waitForTimeout(Number(args.wait ?? 700));
for (const selector of (args.click ?? '').split('|').filter(Boolean)) {
  await page.click(selector);
  await page.waitForTimeout(Number(args.wait ?? 700));
}
const file = path.join(out, `${name}-${theme}.png`);
await page.screenshot({ path: file });
const unmocked = await page.evaluate(() => [...(window.__cxUnmocked ?? [])]);
await browser.close();
console.log(file);
if (unmocked.length) console.log('unmocked:', unmocked.join(', '));
const relevant = errors.filter((e) => !/unmocked command/.test(e));
if (relevant.length) console.log(relevant.slice(0, 10).join('\n'));
