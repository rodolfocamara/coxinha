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
const items = () =>
  within(list())
    .getAllByRole('listitem')
    .map((li) => li.textContent);

it('adds, reorders and removes extra time zones, saved on this computer', async () => {
  const user = userEvent.setup();
  render(<CalendarSection />);
  expect(screen.getByRole('heading', { level: 2, name: 'Calendar' })).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Extra time zones' })).toBeNull();

  const zone = screen.getByRole('combobox', { name: 'Time zone (IANA name)' });
  const label = screen.getByRole('textbox', { name: 'Short label' });
  await user.type(zone, 'Asia/Jerusalem');
  await user.type(label, 'IL');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(zone).toHaveValue('');
  await user.type(zone, 'America/Mexico_City');
  await user.type(label, 'MX{Enter}');
  expect(items()).toEqual(['ILAsia/Jerusalem', 'MXAmerica/Mexico_City']);

  await user.click(screen.getByRole('button', { name: 'Move MX up' }));
  expect(items()).toEqual(['MXAmerica/Mexico_City', 'ILAsia/Jerusalem']);
  expect(screen.getByRole('button', { name: 'Move MX up' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Remove IL' }));
  expect(items()).toEqual(['MXAmerica/Mexico_City']);
  expect(JSON.parse(window.localStorage.getItem('coxinha:calendar-time-zones')!)).toEqual([
    { id: 'America/Mexico_City', label: 'MX' },
  ]);
});

it('explains an unknown zone and names the local column', async () => {
  const user = userEvent.setup();
  render(<CalendarSection />);
  const zone = screen.getByRole('combobox', { name: 'Time zone (IANA name)' });
  await user.type(zone, 'Mars/Base{Enter}');
  expect(screen.getByRole('alert')).toHaveTextContent('Unknown or already listed time zone');
  expect(zone).toHaveAttribute('aria-invalid', 'true');
  await user.type(zone, 'x');
  expect(screen.queryByRole('alert')).toBeNull();

  const local = screen.getByRole('textbox', { name: "Label for this computer's time zone" });
  await user.type(local, 'BR');
  expect(useTimeZones.getState().localLabel).toBe('BR');
  expect(window.localStorage.getItem('coxinha:calendar-local-zone-label')).toBe('BR');
});
