#!/usr/bin/env node
/**
 * Spec 0130 browser check. Needs a Vite dev server (COXINHA_URL). Answers invitations
 * in a real browser against the mocked IPC, so no request can reach Microsoft Graph,
 * and fails on any finding.
 *
 *   COXINHA_URL=http://localhost:14261 node tools/ui-preview/respond-invite.mjs [--out DIR]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initScripts, launch } from './harness.mjs';
import { MEASURE } from './meeting-detail-measure.mjs';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const out = flag('out', '/tmp/cx-0130');
const base = process.env.COXINHA_URL;
if (!base) throw new Error('Set COXINHA_URL to a Vite dev server on a free port.');
// Tuesday noon, as in meeting-detail.mjs: the week holds every fixture.
const NOW = '2026-11-03T12:00:00';
const TEXT = {
  en: { respond: 'Respond to this invitation', review: 'Review', accept: 'Accept', propose: 'Propose a new time', series: 'The whole series', send: /^Send to /, retry: 'Try again', from: 'From', to: 'To', recalled: 'cannot be recalled', sent: /Sent to /, tentative: 'Tentative', nothing: 'Nothing was sent' },
  'pt-BR': { respond: 'Responder a este convite', review: 'Revisar', accept: 'Aceitar', propose: 'Propor novo horário', series: 'A série inteira', send: /^Enviar a /, retry: 'Tentar de novo', from: 'De', to: 'Até', recalled: 'não pode ser desfeito', sent: /Enviada a /, tentative: 'Talvez', nothing: 'Nada foi enviado' },
};

await mkdir(out, { recursive: true });
const browser = await launch();
const scripts = await initScripts({ detail: 1 });
const findings = [];
const notes = [];
const report = (where, detail) => findings.push({ where, detail });

async function open({ locale = 'en', theme = 'dark', fontSize = 16, width = 1280, height = 800, block = /Weekly invite(?!, next)/ }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale });
  const page = await context.newPage();
  const where = `${locale} ${theme} ${fontSize} ${width}x${height}`;
  page.on('pageerror', (e) => report(where, `pageerror: ${e.message}`));
  // Anything that leaves the page would be a bug here: only the dev server may answer.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    report(where, `left the page: ${url}`);
    return route.abort();
  });
  for (const script of scripts) await page.addInitScript(script);
  await page.addInitScript(
    ([t, size, language]) => {
      localStorage.setItem('coxinha.themePref', t);
      localStorage.setItem('coxinha.appearance', JSON.stringify({ fontSize: size, language }));
    },
    [theme, fontSize, locale]
  );
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__coxinha?.router, null, { timeout: 30000 });
  await page.evaluate(() => window.__coxinha.router.navigate({ to: '/meetings', search: { view: 'week' } }));
  await page.locator('.ch-main').getByRole('button', { name: block }).first().click();
  await page.locator('.ch-peek').waitFor();
  return { page, context, where };
}
const calls = (page) => page.evaluate(() => window.__cxRespond.calls);
const dialog = (page) => page.getByRole('dialog');

async function measure(page, where, step) {
  for (const line of await page.evaluate(MEASURE, '.cx-sheet'))
    // These three span the sheet on purpose; their padded content must not.
    if (!/cx-sheet-(header|body|footer)\b/.test(line)) report(where, `${step}: ${line}`);
  const overflow = await page.evaluate(() => {
    const body = document.querySelector('.cx-sheet-body');
    return document.documentElement.scrollWidth > innerWidth || body.scrollWidth > body.clientWidth + 1;
  });
  if (overflow) report(where, `${step}: horizontal overflow`);
}

// Every combination: compose and review stay inside the sheet, nothing is sent.
async function matrix() {
  for (const locale of ['en', 'pt-BR'])
    for (const theme of ['dark', 'light'])
      for (const fontSize of [12, 16, 20])
        for (const [width, height] of [[1280, 800], [800, 600]]) {
          const { page, context, where } = await open({ locale, theme, fontSize, width, height });
          const t = TEXT[locale];
          await page.locator('.ch-peek').getByRole('button', { name: t.respond }).click();
          await dialog(page).getByRole('radio', { name: t.propose }).check();
          await page.waitForTimeout(40);
          await measure(page, where, 'compose');
          const name = `${locale}-${theme}-${fontSize}-${width}`;
          if (fontSize !== 12) await page.screenshot({ path: path.join(out, `compose-${name}.png`) });
          await dialog(page).getByLabel(t.from, { exact: true }).fill('16:00');
          await dialog(page).getByLabel(t.to, { exact: true }).fill('17:30');
          await dialog(page).getByRole('button', { name: t.review }).click();
          await dialog(page).getByRole('button', { name: t.send }).waitFor();
          await measure(page, where, 'review');
          if (fontSize !== 12) await page.screenshot({ path: path.join(out, `review-${name}.png`) });
          if ((await calls(page)).length) report(where, 'sent before the second action');
          const text = await dialog(page).innerText();
          if (!text.includes(t.recalled)) report(where, 'review does not say it cannot be recalled');
          if (!/Ana Almeida/.test(text)) report(where, 'review does not name the organizer');
          if (!/16:00|04:00/.test(text)) report(where, 'review does not show the new time');
          const zone = await page.evaluate(() => new Intl.DateTimeFormat().resolvedOptions().timeZone);
          if (!text.includes(zone)) report(where, 'review does not show the zone');
          await context.close();
        }
}

// Keyboard alone, from the row to a sent response, then focus back on the row.
async function keyboard() {
  const { page, context, where } = await open({ block: /Budget invite/ });
  const t = TEXT.en;
  const action = page.locator('.ch-peek').getByRole('button', { name: t.respond });
  await action.focus();
  await page.keyboard.press('Enter');
  await dialog(page).waitFor();
  await page.waitForTimeout(80);
  const start = await page.evaluate(() => document.activeElement?.closest('[role=dialog]') && document.activeElement.type);
  if (start !== 'radio') report(where, `focus starts on ${start}, not the first answer`);
  await page.keyboard.press('Space');
  if (!(await dialog(page).getByRole('radio', { name: t.accept }).isChecked())) report(where, 'space does not choose an answer');
  const stops = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest('[role=dialog]')) return 'OUTSIDE';
      return (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || '').trim();
    });
    stops.push(label);
    if (label === t.review) break;
  }
  notes.push(`keyboard stops: ${stops.join(' > ')}`);
  if (stops.includes('OUTSIDE')) report(where, 'tab leaves the sheet');
  if (stops.at(-1) !== t.review) report(where, 'tab does not reach Review');
  await page.keyboard.press('Enter');
  await dialog(page).getByRole('button', { name: t.send }).waitFor();
  const onClaim = await page.evaluate(() => document.activeElement?.classList.contains('ch-respond-claim'));
  if (!onClaim) report(where, 'focus is not on the review when it opens');
  if ((await calls(page)).length) report(where, 'keyboard: sent before the second action');
  await page.keyboard.press('Tab');
  const reached = [];
  for (let i = 0; i < 6; i++) {
    const label = await page.evaluate(() => document.activeElement?.textContent?.trim());
    reached.push(label);
    if (/^Send to /.test(label ?? '')) break;
    await page.keyboard.press('Tab');
  }
  if (!/^Send to /.test(reached.at(-1) ?? '')) report(where, `tab does not reach Send: ${reached.join(' > ')}`);
  await page.keyboard.press('Enter');
  await dialog(page).waitFor({ state: 'detached' });
  await page.waitForTimeout(100);
  const sent = await calls(page);
  if (sent.length !== 1) report(where, `expected one request, saw ${sent.length}`);
  const back = await page.evaluate(() => document.activeElement?.className ?? '');
  if (!/ch-prop-action/.test(back)) report(where, `focus did not return to the row: ${back}`);
  await context.close();
}

// Escape closes without sending, and the panel stays open.
async function escape() {
  const { page, context, where } = await open({ block: /Budget invite/ });
  await page.locator('.ch-peek').getByRole('button', { name: TEXT.en.respond }).click();
  await dialog(page).waitFor();
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  if (!(await page.locator('.ch-peek').count())) report(where, 'Escape also closed the panel');
  if ((await calls(page)).length) report(where, 'Escape sent something');
  await context.close();
}

// A failure stays on screen with what was typed; only the owner retries.
async function failureAndRetry() {
  for (const locale of ['en', 'pt-BR']) {
    const t = TEXT[locale];
    const { page, context, where } = await open({ locale, block: /Weekly invite(?!, next)/ });
    await page.evaluate(() => window.__cxRespond.fail.push('calendar.respondOffline'));
    await page.locator('.ch-peek').getByRole('button', { name: t.respond }).click();
    await dialog(page).getByRole('radio', { name: t.tentative }).check();
    await dialog(page).getByRole('radio', { name: t.series }).check();
    await dialog(page).getByRole('textbox').fill('Conflict that morning');
    await dialog(page).getByRole('button', { name: t.review }).click();
    await dialog(page).getByRole('button', { name: t.send }).click();
    await dialog(page).getByRole('alert').waitFor();
    const text = await dialog(page).innerText();
    if (!text.includes(t.nothing)) report(where, 'failure does not say nothing was sent');
    if (!text.includes('Conflict that morning')) report(where, 'failure lost the comment');
    await page.screenshot({ path: path.join(out, `failure-${locale}.png`) });
    await page.waitForTimeout(300);
    if ((await calls(page)).length !== 1) report(where, 'failure retried on its own');
    await dialog(page).getByRole('button', { name: t.retry }).click();
    await dialog(page).waitFor({ state: 'detached' });
    const sent = await calls(page);
    if (sent.length !== 2 || sent[1].request.scope !== 'series' || sent[1].request.comment !== 'Conflict that morning')
      report(where, `retry sent ${JSON.stringify(sent)}`);
    const row = page.locator('.ch-peek');
    await row.getByRole('status').filter({ hasText: t.sent }).waitFor();
    if (!(await row.innerText()).includes(t.tentative)) report(where, 'the row did not change after success');
    await page.screenshot({ path: path.join(out, `sent-${locale}.png`) });
    await context.close();
  }
}

// Only an invitee of a live event gets the action, and a forbidden proposal stays off.
async function availability() {
  const peek = async (block, expected) => {
    const { page, context, where } = await open({ block });
    const count = await page.locator('.ch-peek').getByRole('button', { name: /Respond to this|Change your/ }).count();
    if (count !== expected) report(where, `${block}: ${count} actions, expected ${expected}`);
    await context.close();
  };
  await peek(/Budget invite/, 1);
  await peek(/Closed invite/, 1);
  await peek(/Cancelled invite/, 0);
  await peek(/Roadmap review/, 0);
  await peek(/Focus block/, 0);
  const { page, context, where } = await open({ block: /Closed invite/ });
  await page.locator('.ch-peek').getByRole('button', { name: /Change your/ }).click();
  if (!(await dialog(page).getByRole('radio', { name: /Propose a new time/ }).isDisabled()))
    report(where, 'a forbidden proposal is offered');
  await context.close();
}

await matrix();
await keyboard();
await escape();
await failureAndRetry();
await availability();
await browser.close();

await writeFile(path.join(out, 'findings.json'), JSON.stringify({ findings, notes }, null, 2));
for (const note of notes) console.log(note);
for (const f of findings.slice(0, 40)) console.log(`FAIL ${f.where}: ${f.detail}`);
console.log(`${findings.length} findings`);
process.exit(findings.length ? 1 : 0);
