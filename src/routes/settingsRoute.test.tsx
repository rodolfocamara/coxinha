import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import i18n from '../lib/i18n';
import { mockSettingsBackend, renderSettingsAt } from '../features/settings/settingsPages.harness';
import { resolveSettingsHash } from '../features/settings/settingsIndex';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const tr = (key: string) => i18n.t(key);
const pageTitle = (section: string) =>
  screen.findByRole('heading', { level: 1, name: tr(`people.settings.sections.${section}`) });

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  mockSettingsBackend();
});
afterEach(cleanup);

describe('routes', () => {
  it('opens the first page from /settings, leaving nothing to come back to', async () => {
    const router = renderSettingsAt('/settings');
    await pageTitle('appearance');
    expect(router.state.location.pathname).toBe('/settings/appearance');
    expect(router.history.length).toBe(1);
  });

  it('sends an unknown section to the first page', async () => {
    const router = renderSettingsAt('/settings/nonsense');
    await pageTitle('appearance');
    expect(router.state.location.pathname).toBe('/settings/appearance');
  });
});

describe('history', () => {
  it('follows the section back and forward', async () => {
    const router = renderSettingsAt('/settings/storage');
    await pageTitle('storage');
    await act(() =>
      router.navigate({ to: '/settings/$section', params: { section: 'titles' } } as never)
    );
    await pageTitle('titles');
    expect(
      screen.getByRole('link', { name: tr('people.settings.sections.titles') })
    ).toHaveAttribute('aria-current', 'page');
    act(() => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/storage'));
    await pageTitle('storage');
    expect(
      screen.getByRole('link', { name: tr('people.settings.sections.storage') })
    ).toHaveAttribute('aria-current', 'page');
    act(() => router.history.forward());
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/titles'));
  });
});

describe('old links', () => {
  // Each `/settings#<form>` used by a caller, or that used to resolve in the long page.
  it.each([
    '#appearance',
    '#calendar',
    '#recording',
    '#transcription',
    '#integrations',
    '#shortcuts',
    '#storage',
    '#diagnostics',
    '#appearance-heading',
    '#integrations-heading',
    '#vault-heading',
    '#rebuild-heading',
    '#detection-heading',
    '#integrations-outlook-heading',
    '#titles-heading',
    '#summaries-heading',
    '#time-zones-title',
  ])('/settings%s lands on its page and row', async (hash) => {
    const router = renderSettingsAt(`/settings${hash}`);
    const expected = resolveSettingsHash(hash)!;
    await pageTitle(expected.section);
    expect(router.state.location.pathname).toBe(`/settings/${expected.section}`);
    expect(router.state.location.hash).toBe(expected.target ?? '');
    const focused = expected.target
      ? document.getElementById(expected.target)
      : screen.getByRole('heading', {
          level: 1,
          name: tr(`people.settings.sections.${expected.section}`),
        });
    await waitFor(() => expect(focused ?? document.getElementById(expected.target!)).toHaveFocus());
  });

  it('moves a row hash on the wrong page to the right one', async () => {
    const router = renderSettingsAt('/settings/appearance#rebuild-heading');
    await pageTitle('storage');
    expect(router.state.location.pathname).toBe('/settings/storage');
    await waitFor(() => expect(document.getElementById('rebuild-heading')).toHaveFocus());
  });

  it('gives a row that loads late the focus when it arrives', async () => {
    let answer: (value: unknown) => void = () => {};
    mockSettingsBackend({
      title_llm_settings: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    renderSettingsAt('/settings/titles#summaries-heading');
    await screen.findByText('/fixture/vault');
    const title = await pageTitle('titles');
    await waitFor(() => expect(title).toHaveFocus());
    expect(document.getElementById('summaries-heading')).toBeNull();
    await act(async () =>
      answer({ enabled: false, sshTarget: 'x@y', remotePort: 1, model: 'm', summaries: false })
    );
    await waitFor(() => expect(document.getElementById('summaries-heading')).toHaveFocus());
  });
});
