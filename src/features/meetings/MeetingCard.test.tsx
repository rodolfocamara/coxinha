import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { MeetingCard } from './MeetingCard';

describe('MeetingCard', () => {
  it('renders a "not found" card for unknown meeting ids', () => {
    render(<MeetingCard meetingId="does-not-exist" />);
    expect(screen.getByText('meeting.block.notFound')).toBeInTheDocument();
  });

  it('renders the meeting title, date, and participants count', () => {
    render(<MeetingCard meetingId="it-weekly-status" />);
    expect(screen.getByRole('heading', { name: 'IT Weekly Status Meeting' })).toBeInTheDocument();
    expect(screen.getByText('meeting.label')).toBeInTheDocument();
  });

  it('switches tab content when a different tab is clicked', async () => {
    const user = userEvent.setup();
    render(<MeetingCard meetingId="it-weekly-status" />);

    const summaryTab = screen.getByRole('tab', { name: 'meeting.card.tabs.summary' });
    expect(summaryTab).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'meeting.card.tabs.transcript' }));
    expect(screen.getByRole('tab', { name: 'meeting.card.tabs.transcript' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(summaryTab).toHaveAttribute('aria-selected', 'false');
  });

  it('fires onUnlink for unknown meetings when the handler is provided', async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    render(<MeetingCard meetingId="does-not-exist" onUnlink={onUnlink} />);
    await user.click(screen.getByRole('button', { name: 'meeting.block.unlink' }));
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });
});
