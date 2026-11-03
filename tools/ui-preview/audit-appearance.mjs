#!/usr/bin/env node
/**
 * Usability audit for spec 0125: every screen, at min/default/max font size, in
 * both themes, at a normal and a small window. Fails on clipped, overflowing or
 * overlapping text; ellipsis on purpose is allowed unless it leaves nothing.
 *
 *   pnpm audit:appearance [--sizes 12,16,20] [--themes dark,light]
 *     [--windows 1200x800,800x600] [--screens today,week] [--locales pt-BR,en]
 *     [--engine chromium|webkit] [--out /tmp/cx-appearance] [--shots]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { devServer, here, launch, openApp } from './harness.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => {
    if (value.startsWith('--'))
      pairs.push([
        value.slice(2),
        all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1],
      ]);
    return pairs;
  }, [])
);
const list = (value, fallback) => (value ?? fallback).split(',').filter(Boolean);

const SCREENS = {
  today: '/',
  week: '/meetings?view=week',
  month: '/meetings?view=month',
  meeting: '/meetings/s-rita',
  people: '/people',
  settings: '/settings',
  workspace: '/workspace',
  peek: '/meetings?view=week',
  sheet: '/meetings?view=week',
  palette: '/',
};
/** Screens that only exist after an action: the peek, a sheet, the search palette. */
const ACTIONS = {
  peek: (page) => page.locator('.mh-week-ev').first().click(),
  sheet: (page) => page.locator('.ch-bar button').first().click(),
  palette: (page) => page.keyboard.press('Control+k'),
};
const sizes = list(args.sizes, '12,16,20').map(Number);
const themes = list(args.themes, 'dark,light');
const windows = list(args.windows, '1200x800,800x600').map((w) => {
  const [width, height] = w.split('x').map(Number);
  return { width, height };
});
const screens = list(args.screens, Object.keys(SCREENS).join(','));
const locales = list(args.locales, 'pt-BR');
const engine = args.engine ?? 'chromium';
const out = args.out ?? '/tmp/cx-appearance';
const audit = await readFile(path.join(here, 'audit-text.js'), 'utf8');

await mkdir(out, { recursive: true });
const server = await devServer();
const browser = await launch(engine);
const report = [];
let failures = 0;
try {
  for (const locale of locales)
    for (const size of sizes)
      for (const theme of themes)
        for (const viewport of windows)
          for (const screen of screens) {
            const { page, context, errors } = await openApp(browser, {
              url: server.url,
              route: SCREENS[screen],
              viewport,
              theme,
              locale,
              storage: { 'coxinha.appearance': JSON.stringify({ fontSize: size }) },
            });
            await page.waitForTimeout(Number(args.wait ?? 500));
            if (ACTIONS[screen]) {
              await ACTIONS[screen](page);
              await page.waitForTimeout(400);
            }
            await page.addScriptTag({ content: audit });
            const result = await page.evaluate(() => window.__cxAuditText());
            const name = `${screen}-${size}-${theme}-${viewport.width}-${locale}`;
            if (args.shots) await page.screenshot({ path: path.join(out, `${name}.png`) });
            const actual = await page.evaluate(
              () => getComputedStyle(document.documentElement).fontSize
            );
            if (actual !== `${size}px`)
              result.issues.push({
                kind: 'size-not-applied',
                text: actual,
                where: 'html',
                fontPx: size,
              });
            for (const e of errors)
              result.issues.push({
                kind: 'page-error',
                text: e.slice(0, 120),
                where: 'page',
                fontPx: size,
              });
            failures += result.issues.length;
            report.push({ name, screen, size, theme, ...viewport, locale, ...result });
            console.log(
              `${result.issues.length ? 'FAIL' : 'ok  '} ${name} (${result.textCount} text boxes, ${result.truncated} ellipsis, ${result.issues.length} issues)`
            );
            await context.close();
          }
} finally {
  await browser.close();
  server.stop();
}
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(
  `\n${report.length} screens, ${failures} issues. Report: ${path.join(out, 'report.json')}`
);
process.exit(failures ? 1 : 0);
