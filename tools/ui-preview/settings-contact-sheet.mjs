#!/usr/bin/env node
/**
 * Before and after of the settings area (spec 0129). The "before" images come from a
 * run on the previous commit, passed as a folder; every "after" is taken now.
 *
 *   node tools/ui-preview/settings-contact-sheet.mjs --before <dir> [--out docs/design/settings/pages.png]
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { devServer, launch, openApp } from './harness.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const before = arg('before');
const output = arg('out', 'docs/design/settings/pages.png');
const NORMAL = { width: 1200, height: 800 };
const SMALL = { width: 800, height: 600 };
const PAGES = [
  'appearance',
  'shortcuts',
  'recording',
  'transcription',
  'calendar',
  'integrations',
  'titles',
  'storage',
  'diagnostics',
];

const server = await devServer();
const browser = await launch();
async function shot(
  route,
  { theme = 'dark', viewport = NORMAL, size = 16, locale = 'pt-BR', act }
) {
  const { page, context } = await openApp(browser, {
    url: server.url,
    route,
    viewport,
    theme,
    locale,
    storage: { 'coxinha.appearance': JSON.stringify({ fontSize: size }) },
  });
  await page.waitForTimeout(600);
  if (act) await act(page);
  const buffer = await page.screenshot({ type: 'jpeg', quality: 86 });
  await context.close();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}
const cell = (label, src) =>
  `<figure><figcaption>${label}</figcaption><img src="${src}" /></figure>`;
const file = async (name) =>
  `data:image/jpeg;base64,${(await readFile(path.join(before, name))).toString('base64')}`;
const typeFilter = (query) => async (page) => {
  await page.getByRole('combobox', { name: /Buscar um ajuste|Find a setting/ }).fill(query);
  await page.waitForTimeout(150);
};

try {
  const after = [];
  for (const id of PAGES) after.push(cell(`After: ${id}`, await shot(`/settings/${id}`, {})));
  const states = [
    cell('Light', await shot('/settings/recording', { theme: 'light' })),
    cell('English, light', await shot('/settings/titles', { theme: 'light', locale: 'en' })),
    cell('Filter: "fonte"', await shot('/settings/appearance', { act: typeFilter('fonte') })),
    cell('Row from a link', await shot('/settings#rebuild-heading', {})),
    cell('12 px', await shot('/settings/transcription', { size: 12 })),
    cell('20 px', await shot('/settings/recording', { size: 20 })),
    cell('800 x 600 at 16: sidebar', await shot('/settings/recording', { viewport: SMALL })),
    cell('800 x 600 at 20: bar', await shot('/settings/appearance', { viewport: SMALL, size: 20 })),
    cell(
      '800 x 600 at 20: filter in the bar',
      await shot('/settings/storage', { viewport: SMALL, size: 20, act: typeFilter('fuso') })
    ),
  ];
  const old = [
    cell('Before: 1200 x 800', await file('d.jpg')),
    cell('Before: light', await file('l.jpg')),
    cell('Before: 800 x 600', await file('s.jpg')),
  ];
  const whole = await file('long.jpg');
  const page = await browser.newPage({ viewport: { width: 2200, height: 1200 } });
  await page.setContent(
    `<!doctype html><style>
      body { margin: 16px; background: #1b1c1f; color: #e8e8e6; font: 15px system-ui, sans-serif; }
      main { display: grid; grid-template-columns: 300px 1fr; gap: 18px; align-items: start; }
      section { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; align-items: start; }
      figure { margin: 0; } figcaption { margin-bottom: 4px; }
      img { width: 100%; display: block; border-radius: 6px; }
    </style><main>
      <figure><figcaption>Before: all of it, one page</figcaption><img src="${whole}" /></figure>
      <div><section>${old.join('')}</section><section>${after.join('')}</section><section>${states.join('')}</section></div>
    </main>`,
    { waitUntil: 'load' }
  );
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: true });
  console.log(path.resolve(output));
} finally {
  await browser.close();
  server.stop();
}
