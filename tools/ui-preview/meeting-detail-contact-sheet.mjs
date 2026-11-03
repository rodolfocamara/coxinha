#!/usr/bin/env node
/**
 * Before and after panels from meeting-detail.mjs, side by side, as one PNG.
 *
 *   node tools/ui-preview/meeting-detail-contact-sheet.mjs <before dir> <after dir> <out.png>
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [before, after, out] = process.argv.slice(2);
const STATES = [
  ['upcoming', 'Upcoming'],
  ['past', 'Past with outcome'],
  ['transcript', 'Past, transcript only'],
  ['empty', 'Past without outcome'],
  ['invitees40', '40 invitees'],
  ['longTitle', 'Very long title'],
  ['noAttendees', 'No attendees'],
  ['declined', 'Declined'],
];
const image = (dir, name) =>
  `<img src="data:image/png;base64,${readFileSync(path.join(dir, name)).toString('base64')}">`;
const cell = ([state, label], theme) => `
  <figure data-theme="${theme}">
    <figcaption>${label}, ${theme}</figcaption>
    <div class="pair">
      <div><span>Before</span>${image(before, `${state}-${theme}-panel.png`)}</div>
      <div><span>After</span>${image(after, `${state}-${theme}-panel.png`)}</div>
    </div>
  </figure>`;
const html = `<!doctype html><style>
  body { margin: 0; padding: 24px; width: 2720px; background: #1b1c1f; color: #f2f2f0;
    font: 15px system-ui, sans-serif; display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px 24px; }
  figure { margin: 0; }
  figcaption { margin-bottom: 8px; font-weight: 600; font-size: 17px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .pair span { display: block; margin-bottom: 4px; color: #b9b9b5; }
  img { display: block; width: 320px; }
</style>${['dark', 'light'].flatMap((theme) => STATES.map((s) => cell(s, theme))).join('')}`;

const cache = path.join(os.homedir(), '.cache/ms-playwright');
const build = existsSync(cache)
  ? readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
      .map((d) => path.join(cache, d, 'chrome-linux64/chrome'))
      .find(existsSync)
  : undefined;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? build });
const page = await browser.newPage({ viewport: { width: 2768, height: 1000 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
