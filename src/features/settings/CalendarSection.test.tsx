import { beforeEach, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../lib/i18n';
import { resetTimeZones, useTimeZones } from '../meetingsHub/timeZones';
import { CalendarSection } from './CalendarSection';

beforeEach(async () => {
  window.localStorage.clear();
  resetTimeZones();
  await i18n.changeLanguage('en');
});

const list = () => screen.getByRole('list', { name: 'Extra time zones' });
const rows = () =>
  within(list())
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.font-mono')?.textContent);
const search = () => screen.getByRole('textbox', { name: 'Country or city' });

it('adds a zone by country with its code, then reorders, relabels and removes it', async () => {
  const user = userEvent.setup();
  render(<CalendarSection />);
  expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Extra time zones' })).toBeNull();

  await user.type(search(), 'Israel');
  await user.click(screen.getByRole('button', { name: 'Add Israel · Jerusalem' }));
  expect(search()).toHaveValue('');
  await user.type(search(), 'Mexico{Enter}');
  expect(rows()).toEqual(['Asia/Jerusalem', 'America/Mexico_City']);
  expect(useTimeZones.getState().zones.map((z) => z.label)).toEqual(['IL', 'MX']);

  await user.click(screen.getByRole('button', { name: 'Move America/Mexico_City up' }));
  expect(rows()).toEqual(['America/Mexico_City', 'Asia/Jerusalem']);
  const label = screen.getByRole('textbox', { name: 'Label for America/Mexico_City' });
  expect(label).toHaveValue('MX');
  await user.clear(label);
  await user.type(label, 'CDMX');
  await user.click(screen.getByRole('button', { name: 'Remove Asia/Jerusalem' }));
  expect(rows()).toEqual(['America/Mexico_City']);
  expect(JSON.parse(window.localStorage.getItem('coxinha:calendar-time-zones')!)).toEqual([
    { id: 'America/Mexico_City', label: 'CDMX' },
  ]);
});

it('says when nothing matches, and names the local column', async () => {
  const user = userEvent.setup();
  render(<CalendarSection />);
  await user.type(search(), 'Atlantida');
  expect(screen.getByRole('status')).toHaveTextContent('Nothing found');
  await user.keyboard('{Enter}');
  expect(useTimeZones.getState().zones).toEqual([]);

  const local = screen.getByRole('textbox', { name: "Label for this computer's time zone" });
  await user.type(local, 'BR');
  expect(useTimeZones.getState().localLabel).toBe('BR');
  expect(window.localStorage.getItem('coxinha:calendar-local-zone-label')).toBe('BR');
});
