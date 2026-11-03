// Shared boot for the visual checks: a mocked Tauri IPC with the fixtures, in a
// real browser, against a Vite dev server (spawned here unless COXINHA_URL is set).
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
/** Every run sees the same day, so two runs can be compared pixel by pixel. */
export const FIXED_NOW = '2026-11-03T10:30:00';

// Newest locally installed Chromium; override with PW_CHROMIUM.
export function chromiumPath() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    const exe = path.join(cache, b, 'chrome-linux64/chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

export async function launch(engine = 'chromium') {
  if (engine === 'webkit') return webkit.launch();
  return chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? chromiumPath() });
}

/** The IPC mock and fixtures, in load order, as init scripts. */
export async function initScripts(state = {}) {
  const dir = path.join(here, 'fixtures');
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.js'))
    .sort((a, b) => (a === 'base.js' ? -1 : b === 'base.js' ? 1 : a.localeCompare(b)));
  return [
    `window.__cxState = ${JSON.stringify(state)};`,
    ...(await Promise.all(files.map((f) => readFile(path.join(dir, f), 'utf8')))),
    await readFile(path.join(here, 'mock-ipc.js'), 'utf8'),
  ];
}

/** Starts Vite on a private port, so a running app on 1420 is never touched. */
export async function devServer(port = 14256) {
  if (process.env.COXINHA_URL) return { url: process.env.COXINHA_URL, stop() {} };
  const child = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort'], {
    cwd: path.resolve(here, '../..'),
    stdio: 'ignore',
    detached: true,
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => process.kill(-child.pid) };
    } catch {
      /* Not listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.kill(-child.pid);
  throw new Error('vite did not start');
}

/** A page with the app loaded on `route`; `storage` is seeded before any script runs. */
export async function openApp(
  browser,
  { url, route = '/', viewport, theme = 'dark', locale = 'pt-BR', storage = {}, state = {} }
) {
  const context = await browser.newContext({
    viewport,
    colorScheme: theme === 'light' ? 'light' : 'dark',
    locale,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  for (const script of await initScripts(state)) await page.addInitScript(script);
  await page.addInitScript(
    ([t, seeded]) => {
      localStorage.setItem('coxinha.themePref', t);
      for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
    },
    [theme, storage]
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__coxinha?.router, null, { timeout: 30000 });
  if (route !== '/')
    await page.evaluate((href) => window.__coxinha.router.navigate({ href }), route);
  return { page, context, errors };
}
