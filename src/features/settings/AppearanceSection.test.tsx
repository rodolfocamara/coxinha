import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../lib/i18n';
import {
  APPEARANCE_ELEMENT_ID,
  APPEARANCE_STORAGE_KEY,
  readAppearance,
} from '../../lib/appearance';

const { getConfig, updateConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));
vi.mock('../../lib/bindings', () => ({
  commands: { getConfig, updateConfig },
}));

import { AppearanceSection } from './AppearanceSection';

const tr = (key: string) => i18n.t(`people.settings.${key}`);
const sheet = () => document.getElementById(APPEARANCE_ELEMENT_ID)?.textContent ?? '';

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  document.getElementById(APPEARANCE_ELEMENT_ID)?.remove();
  await i18n.changeLanguage('en');
  getConfig.mockResolvedValue({ status: 'ok', data: { vault_path: '/v', locale: '' } });
  updateConfig.mockResolvedValue({ status: 'ok', data: null });
});
afterEach(cleanup);

describe('interface font size', () => {
  const slider = () => screen.getByRole('slider', { name: tr('fontSize.title') });

  it('is a labelled 12 to 20 range that starts at 16 with no reset on offer', () => {
    render(<AppearanceSection />);
    expect(slider()).toHaveAttribute('min', '12');
    expect(slider()).toHaveAttribute('max', '20');
    expect(slider()).toHaveValue('16');
    expect(slider()).toHaveAccessibleDescription(tr('fontSize.hint'));
    expect(screen.queryByRole('button', { name: tr('fontSize.reset') })).toBeNull();
  });

  it('changes the whole window live and persists', () => {
    render(<AppearanceSection />);
    fireEvent.change(slider(), { target: { value: '19' } });
    expect(sheet()).toContain('html{font-size:19px}');
    expect(slider()).toHaveAttribute('aria-valuetext', '19 px');
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY)!).fontSize).toBe(19);
  });

  it('reset returns to 16, keeps focus on the slider and announces it', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    fireEvent.change(slider(), { target: { value: '19' } });
    await user.click(screen.getByRole('button', { name: tr('fontSize.reset') }));
    expect(slider()).toHaveValue('16');
    expect(slider()).toHaveFocus();
    expect(sheet()).toBe('');
    expect(document.querySelector('p[role="status"]')).toHaveTextContent(tr('fontSize.wasReset'));
  });
});

describe('contrast', () => {
  it('is a labelled 50 to 200 range in steps of 5, as in T3 Code', () => {
    render(<AppearanceSection />);
    const slider = screen.getByRole('slider', { name: tr('contrast.title') });
    expect(slider).toHaveAttribute('min', '50');
    expect(slider).toHaveAttribute('max', '200');
    expect(slider).toHaveAttribute('step', '5');
    fireEvent.change(slider, { target: { value: '150' } });
    expect(sheet()).toContain('--fg-primary:');
    expect(slider).toHaveAttribute('aria-valuetext', '150%');
  });
});

describe('accent', () => {
  it('offers every preset and custom in one radio group, tangerine first and chosen', () => {
    render(<AppearanceSection />);
    const group = screen.getByRole('radiogroup', { name: tr('accent.title') });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(
      ['tangerine', 'blue', 'teal', 'green', 'violet', 'pink', 'graphite', 'custom'].map((id) =>
        tr(`accent.${id}`)
      )
    );
    expect(radios[0]).toBeChecked();
  });

  it('choosing a preset recolours, persists and announces', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: tr('accent.blue') }));
    expect(sheet()).toContain('--accent:');
    expect(readAppearance().accent).toBe('blue');
    expect(document.querySelector('p[role="status"]')).toHaveTextContent(tr('accent.blue'));
  });

  it('shows its computed foreground and, for a dark custom colour, switches to light text', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    expect(screen.queryByLabelText(tr('accent.hex'))).toBeNull();
    await user.click(screen.getByRole('radio', { name: tr('accent.custom') }));
    const hex = screen.getByLabelText(tr('accent.hex'));
    fireEvent.change(hex, { target: { value: '#102060' } });
    expect(readAppearance().customAccent).toBe('#102060');
    expect(screen.getByText(new RegExp(tr('accent.lightText')))).toBeInTheDocument();
  });

  it('ignores a half-typed hex value', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: tr('accent.custom') }));
    const before = readAppearance().customAccent;
    fireEvent.change(screen.getByLabelText(tr('accent.hex')), { target: { value: '#12' } });
    expect(readAppearance().customAccent).toBe(before);
  });
});

describe('language', () => {
  const choose = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
    await user.click(screen.getByRole('combobox', { name: tr('language.title') }));
    await user.click(await screen.findByRole('option', { name: label }));
  };

  it('offers Automatic, Portuguese and English; picking switches the app and the native locale', async () => {
    const user = userEvent.setup();
    const onLocale = vi.fn();
    render(<AppearanceSection onLocale={onLocale} />);
    await choose(user, 'Português (Brasil)');
    await waitFor(() => expect(i18n.language).toBe('pt-BR'));
    expect(readAppearance().language).toBe('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(onLocale).toHaveBeenCalledWith('pt-BR');
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ locale: 'pt-BR', vault_path: '/v' })
      )
    );
  });

  it('Automatic clears the native locale, so the backend follows the OS again', async () => {
    const user = userEvent.setup();
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ language: 'en' }));
    render(<AppearanceSection />);
    await choose(user, tr('language.auto'));
    expect(readAppearance().language).toBe('auto');
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ locale: '' }))
    );
  });

  it('a backend failure leaves the window language changed', async () => {
    const user = userEvent.setup();
    getConfig.mockRejectedValue(new Error('offline'));
    render(<AppearanceSection />);
    await choose(user, 'English');
    await waitFor(() => expect(readAppearance().language).toBe('en'));
    expect(updateConfig).not.toHaveBeenCalled();
  });
});

describe('catalogs', () => {
  it('every appearance string exists in both languages', () => {
    const keys = [
      'sections.appearance',
      'descriptions.appearance',
      'accent.title',
      'accent.tangerine',
      'accent.custom',
      'accent.readable',
      'accent.adjusted',
      'contrast.title',
      'fontSize.title',
      'fontSize.reset',
      'fontSans.title',
      'fontMono.title',
      'fontFamilyDefault',
      'language.title',
      'language.auto',
    ];
    for (const lng of ['en', 'pt-BR'])
      for (const key of keys)
        expect(
          i18n.exists(`people.settings.${key}`, { lng, fallbackLng: [] }),
          `${lng} ${key}`
        ).toBe(true);
  });
});
