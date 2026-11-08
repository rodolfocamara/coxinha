import { idle, onSystemRow, pathname } from './common.mjs';

/**
 * A global chord reaches the app as the desktop's `navigate` event. The browser
 * cannot press one, so this checks the chord on show and what its event does; it
 * says nothing about whether the OS delivers the key.
 */
const system = (action, route, reaches) => async (t) => {
  const { page, row } = await onSystemRow(t, action);
  t.check('listed in Settings', (await row.locator('kbd').innerText()) === t.keysAsShown);
  await page.evaluate((payload) => window.__cxEmit('navigate', payload), { route });
  await idle(page, 700);
  t.check(`its event ${route} lands`, await reaches(page), await pathname(page));
};

export const systemProbes = {
  'system.new_note': system('new_note', 'notes-new', async (page) =>
    /^\/(notes|workspace)\//.test(await pathname(page))
  ),
  'system.open_app': system('open_app', 'home', async (page) => (await pathname(page)) === '/'),
  'system.agenda': system('agenda', 'agenda', async (page) => !/settings/.test(await pathname(page))),
  'system.meetings': system(
    'meetings',
    'meetings',
    async (page) => (await pathname(page)) === '/meetings'
  ),
  'system.toggle_recording': system('toggle_recording', 'toggle-recording', (page) =>
    page.evaluate(() => window.__cxCalls.some((call) => /library_start/.test(call)))
  ),
};
