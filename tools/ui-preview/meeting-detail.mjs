#!/usr/bin/env node
/**
 * Spec 0126 usability checks. Needs a Vite dev server (COXINHA_URL). Opens every
 * state of the meeting detail panel in a real browser and fails on any finding.
 *
 *   COXINHA_URL=http://localhost:14260 node tools/ui-preview/meeting-detail.mjs \
 *     [--out /tmp/cx-0126] [--shots-only] [--states upcoming,past] [--matrix]
 *
 * --matrix also shoots each panel at font sizes 12, 16 and 20, in both languages;
 * --panel-width 300 shoots that matrix at a narrower panel.
 */
import { chromium } from 'playwright';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIT, LABELS, MEASURE } from './meeting-detail-measure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1]?.startsWith('--') ? true : (process.argv[i + 1] ?? true);
};
const out = flag('out', '/tmp/cx-0126');
const shotsOnly = !!flag('shots-only', false);
const matrix = !!flag('matrix', false);
const panelWidth = Number(flag('panel-width', 0));
const base = process.env.COXINHA_URL ?? 'http://localhost:1420';

// Tuesday noon: every fixture hangs off this, so the week always holds them all.
const NOW = '2026-11-03T12:00:00';
const STATES = {
  upcoming: { block: /Platform alignment/, future: true },
  now: { block: /Standup under way/, future: true },
  past: { block: /Roadmap review/, outcome: true },
  past8: { block: /Ledger depreciation/, outcome: true },
  transcript: { block: /Only a transcript/, outcome: true },
  empty: { block: /Nothing came out/, outcome: true },
  invitees40: { block: /All hands/, future: true },
  longTitle: { block: /Quarterly cross-functional/, future: true },
  noAttendees: { block: /Focus block/ },
  declined: { block: /Vendor pitch/ },
  prepared: { block: /Prepared one/, future: true },
  match: { block: /Meeting in Google Chrome/ },
  invite: { block: /Budget invite/, future: true },
};
const picked = flag('states', '') ? String(flag('states')).split(',') : Object.keys(STATES);

function chromiumPath() {
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

const fixtureFiles = (await readdir(path.join(here, 'fixtures')))
  .filter((f) => f.endsWith('.js'))
  .sort((a, b) => (a === 'base.js' ? -1 : b === 'base.js' ? 1 : a.localeCompare(b)));
const scripts = [
  `window.__cxState = ${JSON.stringify({ detail: 1 })};`,
  ...(await Promise.all(fixtureFiles.map((f) => readFile(path.join(here, 'fixtures', f), 'utf8')))),
  await readFile(path.join(here, 'mock-ipc.js'), 'utf8'),
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? chromiumPath() });
const findings = [];
const notes = [];
const report = (state, check, detail) => findings.push({ state, check, detail });

async function openPanel({
  state,
  theme = 'dark',
  locale = 'en',
  width = 1280,
  height = 800,
  fontSize = null,
}) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme === 'light' ? 'light' : 'dark',
    locale,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => report(state, 'pageerror', e.message));
  // Before the fixtures: their dates hang off this clock, not off the day of the run.
  await page.clock.setFixedTime(new Date(NOW));
  for (const script of scripts) await page.addInitScript(script);
  await page.addInitScript(
    ([t, size]) => {
      localStorage.setItem('coxinha.themePref', t);
      if (size) localStorage.setItem('coxinha.appearance', JSON.stringify({ fontSize: size }));
    },
    [theme, fontSize]
  );
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__coxinha?.router, null, { timeout: 30000 });
  await page.evaluate(() =>
    window.__coxinha.router.navigate({ to: '/meetings', search: { view: 'week' } })
  );
  const block = page.locator('.ch-main').getByRole('button', { name: STATES[state].block }).first();
  await block.waitFor({ timeout: 15000 });
  await block.click();
  await page.locator('.ch-peek').waitFor();
  await page.waitForTimeout(350);
  return { page, context, block };
}

// Sizes are px like the CSS around them, so scale both ways: a root font change
// and every size in the panel, whichever way the type setting ends up working.
const SCALES = {
  base: async () => async () => undefined,
  'root-125': async (page) => {
    const tag = await page.addStyleTag({ content: 'html{font-size:20px}' });
    return () => tag.evaluate((el) => el.remove());
  },
  'px-125': async (page) => {
    await page.evaluate(() => {
      const nodes = [document.querySelector('.ch-peek'), ...document.querySelectorAll('.ch-peek *')];
      const sizes = nodes.map((el) => [el, parseFloat(getComputedStyle(el).fontSize)]);
      for (const [el, size] of sizes) el.style.fontSize = `${size * 1.25}px`;
    });
    return () =>
      page.evaluate(() => {
        for (const el of document.querySelectorAll('.ch-peek, .ch-peek *')) el.style.fontSize = '';
      });
  },
};
const widthCss = (w) => `.ch-body[data-peek]{grid-template-columns:220px minmax(0,1fr) ${w}px !important}`;

async function checkOverflow(state) {
  for (const locale of ['en', 'pt-BR']) {
    const { page, context } = await openPanel({ state, locale });
    // Open every group: a list that only fits collapsed still has to fit.
    const closed = page.locator('.ch-peek [aria-expanded="false"]');
    while (await closed.count()) await closed.first().click();
    for (const width of [320, 300, 268]) {
      const tag = await page.addStyleTag({ content: widthCss(width) });
      for (const [scale, apply] of Object.entries(SCALES)) {
        const revert = await apply(page);
        await page.waitForTimeout(30);
        for (const line of await page.evaluate(MEASURE, '.ch-peek'))
          report(state, `overflow ${locale} ${width}px ${scale}`, line);
        await revert();
      }
      await tag.evaluate((el) => el.remove());
    }
    await context.close();
  }
}

async function checkKeyboard(state) {
  const { page, context, block } = await openPanel({ state });
  const onTitle = await page.evaluate(() => document.activeElement?.tagName === 'H2');
  if (!onTitle) report(state, 'keyboard', 'focus does not start on the title');
  const expected = await page.evaluate(() => {
    const visible = (el) => el.getBoundingClientRect().width > 0;
    return [...document.querySelectorAll('.ch-peek button, .ch-peek a[href], .ch-peek input, .ch-peek summary')]
      .filter((el) => visible(el) && !el.disabled)
      .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim());
  });
  const seen = [];
  let last = null;
  for (let i = 0; i < expected.length + 12; i++) {
    await page.keyboard.press('Tab');
    const now = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest('.ch-peek')) return null;
      const r = el.getBoundingClientRect();
      // Tabbing scrolls the body, so positions are compared in its own coordinates.
      const scrolled = el.closest('.ch-peek-body')?.scrollTop ?? 0;
      return { label: (el.getAttribute('aria-label') || el.textContent || '').trim(), top: r.top + scrolled, bottom: r.bottom + scrolled, left: r.left };
    });
    if (!now) break;
    seen.push(now.label);
    // Radios in one group take a single stop, so expected may hold more.
    if (last && now.top + 1 < last.top && now.bottom < last.top)
      report(state, 'keyboard', `tab goes back up: "${last.label}" then "${now.label}"`);
    if (last && Math.abs(now.top - last.top) < 2 && now.left < last.left)
      report(state, 'keyboard', `tab goes right to left: "${last.label}" then "${now.label}"`);
    last = now;
  }
  const radios = await page.locator('.ch-peek input[type="radio"]').count();
  for (const label of expected)
    if (!seen.includes(label) && !radios) report(state, 'keyboard', `not reachable: "${label}"`);
  await page.locator('.ch-peek-title').focus();
  const controls = page.locator('.ch-peek [aria-expanded]');
  for (let i = 0; i < (await controls.count()); i++) {
    const control = controls.nth(i);
    const before = await control.getAttribute('aria-expanded');
    await control.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(30);
    const after = await control.getAttribute('aria-expanded');
    if (before === after) report(state, 'keyboard', 'collapse control did not change aria-expanded');
    const kept = await control.evaluate((el) => document.activeElement === el);
    if (!kept) report(state, 'keyboard', 'collapse control lost focus');
  }
  await page.locator('.ch-peek-title').focus();
  await page.keyboard.press('Escape');
  await page.locator('.ch-peek').waitFor({ state: 'detached' });
  await page.waitForTimeout(60);
  const back = await block.evaluate((el) => document.activeElement === el);
  if (!back) report(state, 'keyboard', 'focus did not return to the block on close');
  notes.push(`${state}: ${seen.length} tab stops: ${seen.join(' > ').slice(0, 300)}`);
  await context.close();
}

async function checkTimeToFind(state) {
  for (const [width, height] of [
    [1280, 800],
    [1366, 768],
  ]) {
    const { page, context } = await openPanel({ state, width, height });
    const inView = async (selector) =>
      page.evaluate(
        ([sel, h]) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.top < h - 40;
        },
        [selector, height]
      );
    if (STATES[state].future) {
      const join = page.locator('.ch-peek').getByRole('button', { name: 'Join in Teams' });
      if (await join.count()) {
        const box = await join.boundingBox();
        if (!box || box.y + box.height > height)
          report(state, 'time to find', `join not in view at ${width}x${height}`);
      }
    }
    if (STATES[state].outcome) {
      const visible = await inView('[data-outcome]');
      if (visible === null) report(state, 'time to find', 'no outcome block');
      else if (!visible) report(state, 'time to find', `outcome not in view at ${width}x${height}`);
      const open = await page.locator('.ch-peek').getByRole('button', { name: 'Open meeting' }).boundingBox();
      if (!open || open.y + open.height > height)
        report(state, 'time to find', `open meeting not in view at ${width}x${height}`);
    }
    await context.close();
  }
}

// The brief's goal: eight invitees at the default font fit, or nearly, without scrolling.
const FIT_SLACK_PX = 48;
const FIT_STATE = 'past8';
async function checkFit() {
  for (const locale of ['en', 'pt-BR']) {
    const { page, context } = await openPanel({ state: FIT_STATE, locale });
    const { scroll, client, over } = await page.evaluate(FIT);
    notes.push(`fit ${locale} 1280x800: body scroll ${scroll}px in ${client}px, ${over}px over`);
    if (over > FIT_SLACK_PX)
      report(FIT_STATE, 'fit', `${locale}: body scrolls ${over}px at 1280x800 (allowed ${FIT_SLACK_PX})`);
    await context.close();
  }
}

// Every line of the body says what it is, and the track ids never reach it.
async function checkLabels(state) {
  const { page, context } = await openPanel({ state });
  for (const line of await page.evaluate(LABELS)) report(state, 'labels', line);
  const closed = page.locator('.ch-peek [aria-expanded="false"]');
  while (await closed.count()) await closed.first().click();
  const text = await page.locator('.ch-peek-body').innerText();
  for (const raw of /\b(output|mic|speaker-\d+|S\d)\b/g[Symbol.matchAll](text))
    report(state, 'labels', `raw track id "${raw[0]}"`);
  if (/\bRequired\b/.test(text)) report(state, 'labels', '"Required" is on a row');
  await context.close();
}

async function shootMatrix(states) {
  for (const state of states)
    for (const theme of ['dark', 'light'])
      for (const locale of ['en', 'pt-BR'])
        for (const fontSize of [12, 16, 20]) {
          const { page, context } = await openPanel({ state, theme, locale, fontSize });
          if (panelWidth) await page.addStyleTag({ content: widthCss(panelWidth) });
          await page.locator('.ch-peek').screenshot({
            path: path.join(out, `matrix-${state}-${theme}-${locale}-${fontSize}.png`),
          });
          const closed = page.locator('.ch-peek [aria-expanded="false"]');
          while (await closed.count()) await closed.first().click();
          await page.locator('.ch-peek').screenshot({
            path: path.join(out, `matrix-${state}-${theme}-${locale}-${fontSize}-open.png`),
          });
          await context.close();
        }
}

// The meeting page takes the same structure in its inspector, at its own width.
async function inspector(sessionId, { theme = 'dark', locale = 'en', shoot = false }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: theme === 'light' ? 'light' : 'dark',
    locale,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => report(sessionId, 'pageerror', e.message));
  await page.clock.setFixedTime(new Date(NOW));
  for (const script of scripts) await page.addInitScript(script);
  await page.addInitScript((t) => localStorage.setItem('coxinha.themePref', t), theme);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__coxinha?.router, null, { timeout: 30000 });
  await page.evaluate(
    (id) => window.__coxinha.router.navigate({ to: '/meetings/$sessionId', params: { sessionId: id } }),
    sessionId
  );
  const panel = page.locator('.mh-insp');
  await panel.waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  if (shoot) await page.screenshot({ path: path.join(out, `inspector-${sessionId}-${theme}.png`) });
  if (!shoot) {
    const closed = page.locator('.mh-insp [aria-expanded="false"]');
    while (await closed.count()) await closed.first().click();
    for (const line of await page.evaluate(MEASURE, '.mh-insp'))
      report(`inspector ${sessionId}`, `overflow ${locale}`, line);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.mh-insp, .mh-insp *')];
      const sizes = nodes.map((el) => [el, parseFloat(getComputedStyle(el).fontSize)]);
      for (const [el, size] of sizes) el.style.fontSize = `${size * 1.25}px`;
    });
    for (const line of await page.evaluate(MEASURE, '.mh-insp'))
      report(`inspector ${sessionId}`, `overflow ${locale} px-125`, line);
  }
  await context.close();
}

for (const theme of ['dark', 'light'])
  for (const state of picked) {
    const { page, context } = await openPanel({ state, theme });
    await page.screenshot({ path: path.join(out, `${state}-${theme}.png`) });
    const panel = page.locator('.ch-peek');
    await panel.screenshot({ path: path.join(out, `${state}-${theme}-panel.png`) });
    if (theme === 'dark' && shotsOnly)
      for (const line of await page.evaluate(MEASURE, '.ch-peek')) report(state, 'overflow 320px', line);
    await context.close();
  }
if (picked.includes(FIT_STATE)) await checkFit();
for (const state of picked) await checkLabels(state);
if (matrix) await shootMatrix(picked);
if (!shotsOnly)
  for (const state of picked) {
    await checkOverflow(state);
    await checkKeyboard(state);
    await checkTimeToFind(state);
  }
for (const id of ['d-past', 'd-prep']) {
  for (const theme of ['dark', 'light']) await inspector(id, { theme, shoot: true });
  if (!shotsOnly) for (const locale of ['en', 'pt-BR']) await inspector(id, { locale });
}
await browser.close();

await writeFile(path.join(out, 'findings.json'), JSON.stringify({ findings, notes }, null, 2));
for (const note of notes) console.log(note);
const grouped = Object.groupBy(findings, (f) => `${f.state} / ${f.check}`);
for (const [key, list] of Object.entries(grouped)) {
  console.log(`FAIL ${key}`);
  for (const f of list.slice(0, 6)) console.log(`  ${f.detail}`);
  if (list.length > 6) console.log(`  … and ${list.length - 6} more`);
}
console.log(`${picked.length} states, ${findings.length} findings`);
process.exit(findings.length && !shotsOnly ? 1 : 0);
