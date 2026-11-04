#!/usr/bin/env node
/**
 * Every shortcut of `src/lib/shortcuts/table.ts`, pressed in a real browser with
 * the real React Flow and editor: `pnpm test:shortcuts`. The run is generated from
 * the table: each chord of each entry runs that entry's probe. Prints one line per
 * check and exits 1 on a failure. Global chords cannot be pressed from a browser:
 * their probes check the row in Settings and what their event does, not the OS.
 */
import { devServer, launch, openApp } from './harness.mjs';
import { PROBES } from './shortcutProbes.mjs';

const server = await devServer(14289);
const browser = await launch();
const failures = [];
const report = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const pressable = (chord) =>
  chord
    .split('+')
    .map((part) => (part === 'Mod' ? 'Control' : /^[A-Z]$/.test(part) ? part.toLowerCase() : part))
    .join('+');

async function runProbe(entry, chord) {
  const contexts = [];
  const errors = [];
  const name = `${entry.id} [${chord}]`;
  const t = {
    chord,
    keysAsShown: chord,
    press: (page) => page.keyboard.press(pressable(chord)),
    check: (what, ok, detail) => report(`${name}: ${what}`, !!ok, detail),
    open: async (route, options = {}) => {
      const opened = await openApp(browser, {
        url: server.url,
        route,
        viewport: { width: 1400, height: 900 },
        locale: 'en',
        ...options,
      });
      contexts.push(opened.context);
      opened.page.on('pageerror', (error) => errors.push(error.message));
      return opened.page;
    },
  };
  try {
    await PROBES[entry.id](t);
    const real = errors.filter((error) => !error.includes('Transition was skipped'));
    if (real.length) report(`${name}: no page errors`, false, real.join('; '));
  } catch (error) {
    report(`${name}: ran to the end`, false, String(error.message ?? error).split('\n')[0]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

/** Rebinding and its failures, which only exist in Settings (spec 0128 P6). */
async function rebinding() {
  const open = async (state = {}) => {
    const opened = await openApp(browser, {
      url: server.url,
      route: '/settings/shortcuts',
      viewport: { width: 1400, height: 900 },
      locale: 'en',
      state,
    });
    const row = opened.page.locator('.cx-settings-row:has(#shortcut-meetings-title)');
    await row.waitFor();
    await opened.page.waitForTimeout(300);
    return { ...opened, row };
  };
  const shown = (row) => row.locator('kbd').innerText();
  const change = (row) => row.getByRole('button', { name: /change the shortcut/i });

  {
    const { page, row, context } = await open({ takenChords: ['Control+Alt+X', 'Ctrl+Alt+X'] });
    await change(row).click();
    await page.keyboard.press('Control+Alt+m');
    await page.waitForTimeout(300);
    report('rebind: a free chord takes effect', (await shown(row)) === 'Ctrl+Alt+M', await shown(row));
    report('rebind: focus returns to the button', await change(row).evaluate((el) => el === document.activeElement));
    await change(row).click();
    await page.keyboard.press('Control+Alt+x');
    await page.waitForTimeout(300);
    const alert = row.getByRole('alert');
    report('rebind: a refused chord is visible', (await alert.count()) === 1 && /holds Ctrl\+Alt\+X/.test(await alert.innerText()));
    report('rebind: the refusal says the old chord stays', /Ctrl\+Alt\+M/.test(await alert.innerText()));
    report('rebind: the old chord stays on the row', (await shown(row)) === 'Ctrl+Alt+M');
    await change(row).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    report('rebind: Esc cancels the capture', (await shown(row)) === 'Ctrl+Alt+M');
    await change(row).click();
    await page.keyboard.press('y');
    await page.waitForTimeout(150);
    report('rebind: a key without a modifier asks for one', (await row.getByRole('status').innerText()).includes('Needs'));
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    report('rebind: Tab leaves the capture', (await row.locator('.cx-chord-capture').count()) === 0);
    await row.getByRole('button', { name: /restore the default/i }).click();
    await page.waitForTimeout(300);
    report('rebind: restore goes back to the default', (await shown(row)) === 'Ctrl+Alt+T');
    await context.close();
  }
  {
    const { page, row, context } = await open({
      shortcutFailure: { meetings: 'taken' },
      shortcutConflict: { agenda: 'Fixture Terminal' },
      wayland: true,
    });
    report('startup: a failed chord is visible on its row', (await row.getByRole('alert').count()) === 1);
    report('startup: the app says so outside Settings too', (await page.getByRole('alert').filter({ hasText: /may not work/ }).count()) === 1);
    const agenda = page.locator('.cx-settings-row:has(#shortcut-agenda-title)');
    report('conflict: the owner the desktop declares is named', /Fixture Terminal/.test(await agenda.innerText()));
    report('wayland: the page says accepted is not proof', (await page.getByText(/does not prove the key arrives/).count()) === 1);
    await context.close();
  }
  {
    const { page, context } = await open();
    report('list: Settings lists the in-app shortcuts', (await page.locator('[data-shortcut="board.remove"]').count()) === 1);
    report('list: no failure notice when nothing failed', (await page.getByRole('alert').count()) === 0);
    await context.close();
  }
}

/** Moving a note to the trash from the side editor, with the board's undo (spec 0128). */
async function sideEditorTrash() {
  const { page, context } = await openApp(browser, {
    url: server.url,
    route: '/workspace',
    viewport: { width: 1400, height: 900 },
    locale: 'en',
  });
  await page.waitForSelector('.react-flow__node-card');
  await page.waitForTimeout(500);
  const nodes = () => page.locator('.react-flow__node').count();
  const total = await nodes();
  const box = await page.locator('.react-flow__node-card').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
  let dialog = false;
  page.on('dialog', async (shown) => {
    dialog = true;
    await shown.dismiss();
  });
  await page.getByTestId('note-actions-trigger').click();
  await page.getByRole('menuitem', { name: /move to trash/i }).click();
  await page.waitForTimeout(450);
  report('trash: no native dialog', !dialog);
  report('trash: the card leaves the board', (await nodes()) === total - 1);
  report('trash: the side editor closes', (await page.locator('.ws-editor').count()) === 0);
  await page.locator('.ws-undo').getByRole('button').click();
  await page.waitForTimeout(450);
  report('trash: undo brings the card back', (await nodes()) === total);
  await context.close();
}

try {
  const first = await openApp(browser, {
    url: server.url,
    route: '/settings/shortcuts',
    viewport: { width: 1400, height: 900 },
    locale: 'en',
  });
  // Read through Vite, as the app does: nothing here restates the table.
  const table = await first.page.evaluate(
    async () => (await import('/src/lib/shortcuts/table.ts')).SHORTCUTS
  );
  await first.context.close();
  report(`the table has ${table.length} shortcuts`, table.length > 0);

  for (const entry of table) {
    if (!PROBES[entry.id]) {
      report(`${entry.id}: has a probe`, false);
      continue;
    }
    for (const chord of entry.keys) await runProbe(entry, chord);
  }
  for (const id of Object.keys(PROBES))
    if (!table.some((entry) => entry.id === id)) report(`${id}: is still in the table`, false);
  await rebinding();
  await sideEditorTrash();
} finally {
  await browser.close();
  server.stop();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
