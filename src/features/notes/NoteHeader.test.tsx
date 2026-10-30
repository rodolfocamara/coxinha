import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { NoteHeader, formatNoteMeta } from './NoteHeader';

describe('NoteHeader', () => {
  it('renders the supplied title at display size', () => {
    render(<NoteHeader title="Reunião Trinca" tags={[]} updatedAt="2026-04-18T09:12:00Z" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Reunião Trinca');
    expect(heading.className).toContain('cx-display');
  });

  it('falls back to the untitled label when the title is empty', () => {
    render(<NoteHeader title="" tags={[]} updatedAt="2026-04-18T09:12:00Z" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('sidebar.untitled');
  });

  it('shows the formatted date without claiming unsaved edits are saved', () => {
    const { container } = render(
      <NoteHeader title="Note" tags={[]} updatedAt="2026-04-18T09:12:00Z" />
    );
    const meta = container.querySelector('p');
    expect(meta?.textContent).toContain('2026');
    expect(meta?.textContent).not.toMatch(/Saved/);
  });

  it('hides the meta row when updatedAt is not a parsable date', () => {
    const { container } = render(<NoteHeader title="Note" tags={[]} updatedAt="" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders a tag chip for every supplied tag', () => {
    render(
      <NoteHeader
        title="Note"
        tags={['meeting', 'trinca', 'kickoff']}
        updatedAt="2026-04-18T09:12:00Z"
      />
    );
    const chips = screen.getByTestId('note-tag-row').querySelectorAll('span');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent('#meeting');
    expect(chips[2]).toHaveTextContent('#kickoff');
  });

  it('omits the tag row entirely when the tags array is empty', () => {
    render(<NoteHeader title="Note" tags={[]} updatedAt="2026-04-18T09:12:00Z" />);
    expect(screen.queryByTestId('note-tag-row')).toBeNull();
  });
});

describe('formatNoteMeta', () => {
  it('returns an empty string on an unparsable input', () => {
    expect(formatNoteMeta('definitely-not-a-date')).toBe('');
  });

  it('formats a valid timestamp without a save-state claim', () => {
    expect(formatNoteMeta('2026-04-18T09:12:00Z')).toContain('2026');
    expect(formatNoteMeta('2026-04-18T09:12:00Z')).not.toContain('Saved');
  });
});
