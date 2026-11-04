#!/usr/bin/env node
// Real Chromium contract, using the repository's existing Vite/Playwright workflow.
// All IPC and save participants belong to the disposable fixture, never a user vault.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, 'target/window-corners-browser'));
await mkdir(output, { recursive: true });
const index = await readFile(path.join(root, 'index.html'), 'utf8');
const server = await createServer({
  root,
  cacheDir: path.join(output, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  plugins: [
    {
      name: 'window-corner-contract',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/__corner-test')) return next();
          const html = index
            .replace('/src/main.tsx', '/tools/fixtures/window-corners.tsx')
            .replace(
              '<head>',
              '<head><script>window.isTauri = new URLSearchParams(location.search).has("native");</script>'
            );
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml(req.url, html));
        });
      },
    },
  ],
});
const results = [];
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    ...(process.env.COXINHA_CHROMIUM ? { executablePath: process.env.COXINHA_CHROMIUM } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  async function check(name, run) {
    try {
      const evidence = await run();
      results.push({ name, passed: true, ...(evidence ? { evidence } : {}) });
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    }
  }
  async function api(method, argument) {
    await page.evaluate(({ method, argument }) => window.__cornerTest[method](argument), {
      method,
      argument,
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
  }
  async function pixels(name) {
    const screenshot = await page.screenshot({
      path: path.join(output, `${name}.png`),
      omitBackground: true,
    });
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
      return {
        corners: [
          alpha(0, 0),
          alpha(image.width - 1, 0),
          alpha(0, image.height - 1),
          alpha(image.width - 1, image.height - 1),
        ],
        diagonal: alpha(3, 3),
      };
    }, screenshot.toString('base64'));
  }
  async function load(native) {
    await page.goto(`${origin}__corner-test${native ? '?native' : ''}`);
    await page.waitForFunction(() => Boolean(window.__cornerTest));
    if (native) await page.locator('[data-resize-enabled=true]').waitFor();
  }
  await load(true);
  for (const scene of ['palette', 'portal', 'exit']) {
    if (scene === 'exit') {
      await api('showExit');
      await page.getByRole('status').waitFor();
    } else {
      await api('setScene', scene);
      await page
        .locator(scene === 'palette' ? '[role=dialog]' : '[data-testid=body-portal]')
        .waitFor();
    }
    await check(`restored ${scene} has four transparent corners`, async () => {
      const sample = await pixels(`restored-${scene}`);
      assert.deepEqual(sample.corners, [0, 0, 0, 0]);
      assert.ok(sample.diagonal > 0, '(3,3) must remain inside the native window');
      return sample;
    });
    if (scene === 'exit') await api('hideExit');
    else await api('setScene', 'none');
  }
  await api('setScene', 'menu');
  await page.getByTestId('note-actions-menu').waitFor();
  await check(
    'fixed note dropdown keeps viewport coordinates outside its inner overflow container',
    async () => {
      const geometry = await page.evaluate(() => {
        const anchor = document.querySelector('button').getBoundingClientRect();
        const menu = document
          .querySelector('[data-testid=note-actions-menu]')
          .getBoundingClientRect();
        const inner = document
          .querySelector('[data-testid=inner-container]')
          .getBoundingClientRect();
        const hit = document.elementFromPoint(menu.x + 30, menu.y + 65);
        return {
          top: menu.top,
          expected: anchor.bottom + 8,
          outsideInner: menu.y + 65 > inner.bottom,
          hit: Boolean(hit?.closest('[data-testid=note-actions-menu]')),
        };
      });
      assert.equal(geometry.top, geometry.expected);
      assert.equal(geometry.outsideInner, true);
      assert.equal(geometry.hit, true);
    }
  );
  await api('setScene', 'palette');
  for (const mode of ['maximized', 'fullscreen', 'restored']) {
    await api('setMode', mode);
    await check(`${mode} global clip follows native state with a fixed overlay`, async () => {
      const sample = await pixels(mode);
      if (mode === 'restored') assert.deepEqual(sample.corners, [0, 0, 0, 0]);
      else assert.ok(sample.corners.every((alpha) => alpha === 255));
      return sample;
    });
  }
  await api('setScene', 'none');
  await api('setMounted', false);
  await check('route/provider removal clears viewport ownership', async () => {
    assert.equal(
      await page.evaluate(() => document.documentElement.hasAttribute('data-window-rounded')),
      false
    );
    assert.equal(await page.locator('[data-window-resize]').count(), 0);
  });
  await api('setMounted', true);
  await page.locator('[data-resize-enabled=true]').waitFor();
  await check('provider remount restores clipping and all eight handles', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowRounded), 'true');
    assert.equal(await page.locator('[data-window-resize]').count(), 8);
    assert.deepEqual((await pixels('remount')).corners, [0, 0, 0, 0]);
  });
  await load(false);
  await api('setScene', 'palette');
  await check('normal browser preview stays opaque and square with no global clip', async () => {
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).clipPath), 'none');
    assert.deepEqual((await pixels('preview')).corners, [255, 255, 255, 255]);
  });
  await check('no browser runtime errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close();
  await server.close();
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        scope:
          'Real Chromium compositor, production React components, synthetic native IPC; no native compositor proof',
        results,
      },
      null,
      2
    ) + '\n'
  );
  for (const result of results)
    console.log(
      `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`
    );
}
assert.ok(
  results.length >= 10 && results.every((result) => result.passed),
  'Window corner browser contracts failed'
);
