import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { audioTime, RecordingInformation } from './RecordingInformation';
const storage = {
  directory: '/local/library/raw/synthetic',
  totalBytes: 1048576,
  durationMs: 120000,
  files: [
    { name: 'mic.wav', bytes: 1048576 },
    { name: 'output.wav', bytes: 0 },
  ],
};
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
it('shows audio duration distinct from elapsed capture time, with measured audio-only size', () => {
  render(<RecordingInformation storage={storage} elapsedMs={180000} />);
  expect(screen.getByText('00:02:00')).toBeVisible();
  expect(screen.getByText('00:03:00')).toBeVisible();
  expect(screen.getByText('1 MiB')).toBeVisible();
  expect(screen.getByText(storage.directory)).not.toBeVisible();
  fireEvent.click(screen.getByText('Local files'));
  expect(screen.getByText(storage.directory)).toBeVisible();
});
it('never invents missing byte counts, durations or processing ETA', () => {
  render(
    <RecordingInformation
      storage={{ ...storage, totalBytes: null, durationMs: null }}
      processing="inference"
    />
  );
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  expect(screen.getByRole('status')).toHaveTextContent('Remaining time not yet available');
  expect(screen.queryByText('0 MiB')).toBeNull();
  expect(audioTime(3601)).toBe('01:00:01');
});
it('copies the display path only through an explicit action and localizes pt-BR', async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  await i18n.changeLanguage('pt-BR');
  render(<RecordingInformation storage={storage} />);
  expect(copy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Arquivos locais'));
  fireEvent.click(screen.getByText('Copiar caminho da pasta'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Caminho copiado'));
  expect(copy).toHaveBeenCalledWith(storage.directory);
});
