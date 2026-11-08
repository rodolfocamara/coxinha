#!/usr/bin/env node
/**
 * Contact sheet of the appearance settings (spec 0125): every screen by size,
 * theme and window, plus accents and contrast. Writes one PNG.
 *
 *   node tools/ui-preview/contact-sheet.mjs [--out docs/design/appearance/contact-sheet.png]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { devServer, launch, openApp } from './harness.mjs';

const at = process.argv.indexOf('--out');
const output = at > 0 ? process.argv[at + 1] : 'docs/design/appearance/contact-sheet.png';
const SCREENS = [
  ['Today', '/'],
  ['Week', '/meetings?view=week'],
  ['Month', '/meetings?view=month'],
  ['Meeting', '/meetings/s-rita'],
  ['People', '/people'],
  ['Settings', '/settings'],
];
const NORMAL = { width: 1200, height: 800 };
const SMALL = { width: 800, height: 600 };
const COLUMNS = [
  { label: '12 px, dark', theme: 'dark', look: { fontSize: 12 }, viewport: NORMAL },
  { label: '16 px (default), dark', theme: 'dark', look: { fontSize: 16 }, viewport: NORMAL },
  { label: '20 px, dark', theme: 'dark', look: { fontSize: 20 }, viewport: NORMAL },
  { label: '20 px, dark, 800x600', theme: 'dark', look: { fontSize: 20 }, viewport: SMALL },
  { label: '16 px (default), light', theme: 'light', look: { fontSize: 16 }, viewport: NORMAL },
  { label: '20 px, light', theme: 'light', look: { fontSize: 20 }, viewport: NORMAL },
];
const LOOKS = [
  { label: 'Blue, light', theme: 'light', look: { accent: 'blue' } },
  { label: 'Teal, dark', theme: 'dark', look: { accent: 'teal' } },
  { label: 'Violet, dark', theme: 'dark', look: { accent: 'violet' } },
  { label: 'Graphite, light', theme: 'light', look: { accent: 'graphite' } },
  {
    label: 'Custom #102060 (light text), dark',
    theme: 'dark',
    look: { accent: 'custom', customAccent: '#102060' },
  },
  {
    label: 'Custom #ffe600 (dark text), light',
    theme: 'light',
    look: { accent: 'custom', customAccent: '#ffe600' },
  },
];
const CONTRASTS = [
  { label: 'Contrast 50%, dark', theme: 'dark', look: { contrast: 50 } },
  { label: 'Contrast 200%, dark', theme: 'dark', look: { contrast: 200 } },
  { label: 'Contrast 50%, light', theme: 'light', look: { contrast: 50 } },
  { label: 'Contrast 200%, light', theme: 'light', look: { contrast: 200 } },
];

const server = await devServer();
const browser = await launch();
async function shot(route, { theme, look, viewport = NORMAL }) {
  const { page, context } = await openApp(browser, {
    url: server.url,
    route,
    viewport,
    theme,
    storage: { 'coxinha.appearance': JSON.stringify(look) },
  });
  await page.waitForTimeout(600);
  const buffer = await page.screenshot({ type: 'jpeg', quality: 86 });
  await context.close();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}
const cell = (label, src) =>
  `<figure><figcaption>${label}</figcaption><img src="${src}" /></figure>`;

try {
  const rows = [];
  for (const [name, route] of SCREENS) {
    const cells = [];
    for (const column of COLUMNS)
      cells.push(cell(`${name}: ${column.label}`, await shot(route, column)));
    rows.push(`<section>${cells.join('')}</section>`);
  }
  const looks = [];
  for (const entry of LOOKS)
    looks.push(cell(entry.label, await shot('/meetings?view=week', entry)));
  rows.push(`<section>${looks.join('')}</section>`);
  const contrasts = [];
  for (const entry of CONTRASTS) contrasts.push(cell(entry.label, await shot('/', entry)));
  rows.push(`<section>${contrasts.join('')}</section>`);

  const page = await browser.newPage({ viewport: { width: 2520, height: 1200 } });
  await page.setContent(
    `<!doctype html><style>
      body { margin: 16px; background: #1b1c1f; color: #e8e8e6; font: 15px system-ui, sans-serif; }
      section { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 18px; align-items: start; }
      figure { margin: 0; } figcaption { margin-bottom: 4px; }
      img { width: 100%; display: block; border-radius: 6px; }
    </style>${rows.join('')}`,
    { waitUntil: 'load' }
  );
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: true });
  console.log(path.resolve(output));
} finally {
  await browser.close();
  server.stop();
}
