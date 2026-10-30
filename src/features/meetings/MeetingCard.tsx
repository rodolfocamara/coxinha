import { useState } from 'react';
import { Calendar, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useMeeting, type MeetingRow } from './fixtures';

interface Props {
  meetingId: string;
  onUnlink?: () => void;
}

type Tab = 'summary' | 'transcript' | 'actionItems';

export function MeetingCard({ meetingId, onUnlink }: Props) {
  const { t } = useTranslation();
  const meeting = useMeeting(meetingId);

  if (!meeting) {
    return (
      <aside className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground flex items-center justify-between gap-3">
        <span>{t('meeting.block.notFound')}</span>
        {onUnlink && (
          <button
            type="button"
            onClick={onUnlink}
            className="px-2 py-1 rounded-md border border-border hover:bg-secondary/60 text-xs"
          >
            {t('meeting.block.unlink')}
          </button>
        )}
      </aside>
    );
  }

  return <MeetingCardInner meeting={meeting} />;
}

function MeetingCardInner({ meeting }: { meeting: MeetingRow }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('summary');
  const date = formatMeetingDate(meeting.startsAt);

  return (
    <article className="rounded-md border border-border bg-card overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div
          className="w-9 h-9 rounded-md shrink-0 flex items-center justify-center"
          style={{ backgroundColor: 'oklch(var(--bg-surface-2))' }}
          aria-hidden="true"
        >
          <Calendar size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {t('meeting.label')}
          </p>
          <h3 className="text-[15px] font-semibold truncate">{meeting.title}</h3>
        </div>
        <div className="text-xs text-muted-foreground text-right shrink-0">
          <div className="flex items-center gap-1 justify-end">
            <Calendar size={12} aria-hidden="true" />
            <span>{date}</span>
          </div>
          <div className="flex items-center gap-1 justify-end mt-0.5">
            <Users size={12} aria-hidden="true" />
            <span>{meeting.participants.length}</span>
          </div>
        </div>
      </header>
      <div role="tablist" className="flex items-center gap-1 px-3 py-1 border-b border-border">
        <TabButton
          label={t('meeting.card.tabs.summary')}
          active={tab === 'summary'}
          onClick={() => setTab('summary')}
        />
        <TabButton
          label={t('meeting.card.tabs.transcript')}
          active={tab === 'transcript'}
          onClick={() => setTab('transcript')}
        />
        <TabButton
          label={t('meeting.card.tabs.actionItems')}
          active={tab === 'actionItems'}
          onClick={() => setTab('actionItems')}
        />
      </div>
      <div className="px-4 py-3 text-[14px] leading-6 text-foreground">
        <TabPanel tab={tab} meeting={meeting} />
      </div>
    </article>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'px-3 py-1 rounded-md text-sm transition-colors ' +
        (active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60')
      }
    >
      {label}
    </button>
  );
}

function TabPanel({ tab, meeting }: { tab: Tab; meeting: MeetingRow }) {
  const md =
    tab === 'summary'
      ? meeting.summaryMd
      : tab === 'transcript'
        ? meeting.transcriptMd
        : meeting.actionItemsMd;
  return <div className="whitespace-pre-wrap font-[var(--font-sans)]">{md}</div>;
}

function formatMeetingDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
