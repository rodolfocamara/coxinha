import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { resetSystemChords, useSystemChords } from '../../lib/shortcuts';
import type { ShortcutReport } from '../../lib/bindings';
import { ShortcutsSection } from './ShortcutsSection';

const mocks = vi.hoisted(() => ({ status: vi.fn(), set: vi.fn() }));
vi.mock('../../lib/bindings', () => ({
  commands: {
    shortcutStatus: (...args: unknown[]) => mocks.status(...args),
    setShortcut: (...args: unknown[]) => mocks.set(...args),
  },
}));

const CONFIG = {
  new_note: 'Ctrl+Alt+Y',
  open_app: 'Ctrl+Alt+O',
  agenda: 'Ctrl+Alt+G',
  meetings: 'Ctrl+Alt+T',
  toggle_recording: 'Ctrl+Alt+W',
} as const;

const report = (over: Record<string, object> = {}, wayland = false): ShortcutReport => ({
  wayland,
  statuses: Object.entries(CONFIG).map(([action, chord]) => ({
    action: action as keyof typeof CONFIG,
    chord,
    registered: true,
    failure: null,
    detail: null,
    conflict: null,
    lastFiredMs: null,
    ...over[action],
  })),
});
const ok = (data: unknown) => ({ status: 'ok', data });

async function mount() {
  render(<ShortcutsSection shortcuts={CONFIG} />);
  await waitFor(() => expect(useSystemChords.getState().report).not.toBeNull());
}
const row = (action: string) =>
  document.getElementById(`shortcut-${action}-title`)!.closest<HTMLElement>('.cx-settings-row')!;
const change = (action = 'meetings') =>
  within(row(action)).getByRole('button', { name: /^Change the shortcut/ });
const capture = () => screen.getByRole('button', { name: /^Press the new shortcut/ });
const chordPress = { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true };

beforeEach(async () => {
  await i18n.changeLanguage('en');
  resetSystemChords();
  mocks.status.mockReset();
  mocks.set.mockReset();
  mocks.status.mockResolvedValue(ok(report()));
});
afterEach(cleanup);

it('takes the next chord pressed, applies it and returns focus', async () => {
  const next = report({ meetings: { chord: 'Ctrl+Alt+M' } });
  mocks.set.mockResolvedValue(ok({ ok: true, failure: null, detail: null, report: next }));
  await mount();
  fireEvent.click(change());
  expect(capture()).toHaveFocus();
  fireEvent.keyDown(capture(), chordPress);
  expect(mocks.set).toHaveBeenCalledWith('meetings', 'Ctrl+Alt+M');
  await waitFor(() => expect(within(row('meetings')).getByText('Ctrl+Alt+M')).toBeInTheDocument());
  await waitFor(() => expect(change()).toHaveFocus());
});

it('shows a refused chord, and that the old one stays in force', async () => {
  mocks.set.mockResolvedValue(
    ok({ ok: false, failure: 'taken', detail: 'already registered', report: report() })
  );
  await mount();
  fireEvent.click(change());
  fireEvent.keyDown(capture(), chordPress);
  const alert = await within(row('meetings')).findByRole('alert');
  expect(alert).toHaveTextContent('Another app already holds Ctrl+Alt+M');
  expect(alert).toHaveTextContent('Ctrl+Alt+T');
  expect(within(row('meetings')).getByText('Ctrl+Alt+T')).toBeInTheDocument();
});

it('names the action that already uses a duplicate chord', async () => {
  mocks.set.mockResolvedValue(
    ok({ ok: false, failure: 'duplicate', detail: 'agenda', report: report() })
  );
  await mount();
  fireEvent.click(change());
  fireEvent.keyDown(capture(), chordPress);
  expect(await within(row('meetings')).findByRole('alert')).toHaveTextContent(
    "already the shortcut for Open today's agenda"
  );
});

it('reports a transport failure as visibly as a refusal', async () => {
  mocks.set.mockResolvedValue({ status: 'error', error: 'ipc gone' });
  await mount();
  fireEvent.click(change());
  fireEvent.keyDown(capture(), chordPress);
  expect(await within(row('meetings')).findByRole('alert')).toHaveTextContent(
    'The system refused Ctrl+Alt+M'
  );
});

it('Esc cancels, with no change and without reaching the app shortcuts', async () => {
  await mount();
  fireEvent.click(change());
  expect(fireEvent.keyDown(capture(), { key: 'Escape', code: 'Escape' })).toBe(false);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /^Press the new shortcut/ })).toBeNull();
});

it('never traps the keyboard: Tab leaves, and leaving cancels', async () => {
  await mount();
  fireEvent.click(change());
  expect(fireEvent.keyDown(capture(), { key: 'Tab', code: 'Tab' })).toBe(true);
  fireEvent.blur(capture());
  expect(screen.queryByRole('button', { name: /^Press the new shortcut/ })).toBeNull();
});

it('asks for a modifier, and waits through a modifier alone', async () => {
  await mount();
  fireEvent.click(change());
  fireEvent.keyDown(capture(), { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  expect(capture()).toBeInTheDocument();
  fireEvent.keyDown(capture(), { key: 'y', code: 'KeyY' });
  expect(mocks.set).not.toHaveBeenCalled();
  expect(within(row('meetings')).getByRole('status')).toHaveTextContent('Needs Ctrl, Alt or Super');
});

it('restores the default of a changed chord, and offers it only then', async () => {
  mocks.status.mockResolvedValue(ok(report({ meetings: { chord: 'Ctrl+Alt+M' } })));
  mocks.set.mockResolvedValue(ok({ ok: true, failure: null, detail: null, report: report() }));
  await mount();
  await within(row('meetings')).findByText('Ctrl+Alt+M');
  expect(within(row('agenda')).queryByRole('button', { name: /^Restore/ })).toBeNull();
  fireEvent.click(within(row('meetings')).getByRole('button', { name: /^Restore/ }));
  expect(mocks.set).toHaveBeenCalledWith('meetings', 'Ctrl+Alt+T');
  await waitFor(() => expect(within(row('meetings')).getByText('Ctrl+Alt+T')).toBeInTheDocument());
});

it('shows a chord that failed at startup on its own row', async () => {
  mocks.status.mockResolvedValue(
    ok(report({ meetings: { registered: false, failure: 'taken', detail: 'x' } }))
  );
  await mount();
  const alert = await within(row('meetings')).findByRole('alert');
  expect(alert).toHaveTextContent('Not active: Ctrl+Alt+T did not register');
  expect(within(row('agenda')).queryByRole('alert')).toBeNull();
});

it('names the app the desktop gives a chord to', async () => {
  mocks.status.mockResolvedValue(ok(report({ meetings: { conflict: 'Fixture Terminal' } })));
  await mount();
  await waitFor(() =>
    expect(row('meetings')).toHaveTextContent('Ctrl+Alt+T also belongs to Fixture Terminal')
  );
});

it('under Wayland says a registered chord is no proof, and shows what is', async () => {
  mocks.status.mockResolvedValue(
    ok(report({ meetings: { lastFiredMs: new Date(2026, 10, 4, 10, 30).getTime() } }, true))
  );
  await mount();
  expect(await screen.findByText(/does not prove the key arrives/)).toBeInTheDocument();
  expect(row('meetings')).toHaveTextContent('Last reached Coxinha at 10:30');
  expect(row('agenda')).toHaveTextContent('Has not reached Coxinha since the app started');
});

it('asks the desktop again when the window comes back', async () => {
  await mount();
  const calls = mocks.status.mock.calls.length;
  fireEvent.focus(window);
  await waitFor(() => expect(mocks.status.mock.calls.length).toBe(calls + 1));
});

it('without a desktop still shows the chords of the config', async () => {
  mocks.status.mockRejectedValue(new Error('no backend'));
  render(<ShortcutsSection shortcuts={CONFIG} />);
  expect(await within(row('meetings')).findByText('Ctrl+Alt+T')).toBeInTheDocument();
  expect(row('meetings')).not.toHaveTextContent('Has not reached');
});

it('lists the in-app shortcuts, read from the table', async () => {
  await mount();
  const remove = document.querySelector('[data-shortcut="board.remove"]')!;
  expect(remove).toHaveTextContent('Remove the selection');
  expect(remove).toHaveTextContent('Delete');
  expect(remove).toHaveTextContent('Backspace');
  expect(document.querySelector('[data-shortcut="dialog.focusTrap"]')).toBeNull();
});

it('has the same shape in Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  mocks.set.mockResolvedValue(ok({ ok: false, failure: 'taken', detail: 'x', report: report() }));
  await mount();
  fireEvent.click(within(row('meetings')).getByRole('button', { name: /^Alterar o atalho/ }));
  fireEvent.keyDown(screen.getByRole('button', { name: /^Pressione o novo atalho/ }), chordPress);
  expect(await within(row('meetings')).findByRole('alert')).toHaveTextContent(
    'Outro aplicativo já usa'
  );
});
