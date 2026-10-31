import { useTranslation } from 'react-i18next';
import { CalendarDays, Plus, RefreshCw, Search, Settings2, Upload } from 'lucide-react';
import { Alert, Button, EmptyState, Input } from '../../components/ui';
import { LiveBadge } from '../capture/LiveBadge';
import type { OutlookConnection } from '../agenda/useOutlookConnection';
import {
  attendeesOf,
  scheduledMs,
  type Attention,
  type GroupId,
  type MeetingRow,
} from './meetingRows';
import { clockTime, durationLabel, rowTime } from './format';
import { TabBar } from './TabBar';
import { localDay, nextDay } from '../sessions/sessionDates';

export type ListTab = 'list' | 'review' | 'month';

type Props = {
  groups: { id: GroupId | 'review'; rows: MeetingRow[] }[];
  reviewCount: number;
  tab: ListTab;
  onTab: (tab: ListTab) => void;
  query: string;
  onQuery: (query: string) => void;
  selectedKey: string | null;
  onSelect: (row: MeetingRow) => void;
  onNew: () => void;
  onImport: () => void;
  onOutlook: () => void;
  outlook: OutlookConnection;
  isLive: (row: MeetingRow) => boolean;
  attention: (row: MeetingRow) => Attention;
  now: Date;
  loadFailed: boolean;
  loading: boolean;
  onRetry: () => void;
  desktop: boolean;
};

export function MeetingList(p: Props) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`meetingsHub.${key}`, options);
  const anyLive = p.groups.some((g) => g.id === 'now' && g.rows.some(p.isLive));
  const total = p.groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <section className="mh-list" aria-labelledby="meetings-heading">
      <header className="mh-list-head">
        <h1 id="meetings-heading">{k('title')}</h1>
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Upload size={15} aria-hidden="true" />}
            aria-label={k('importAudio')}
            title={k('importAudio')}
            disabled={!p.desktop}
            onClick={p.onImport}
          />
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={!p.desktop}
            onClick={p.onNew}
          >
            {k('new')}
          </Button>
        </div>
      </header>
      <TabBar<ListTab>
        idPrefix="meetings-list"
        label={k('views')}
        value={p.tab}
        onChange={p.onTab}
        className="px-3.5"
        tabs={[
          { id: 'list', label: k('tabs.list') },
          {
            id: 'review',
            label: (
              <>
                {k('tabs.review')}
                {p.reviewCount > 0 && (
                  <span className="mh-pill" data-tone="warning">
                    {p.reviewCount}
                  </span>
                )}
              </>
            ),
          },
          { id: 'month', label: k('tabs.month') },
        ]}
      />
      <div className="mh-search">
        <Search size={14} aria-hidden="true" className="mh-search-icon" />
        <Input
          size="sm"
          type="search"
          value={p.query}
          aria-label={k('search')}
          placeholder={k('search')}
          onChange={(e) => p.onQuery(e.target.value)}
        />
      </div>
      <div
        className="mh-scroll"
        id={`meetings-list-panel-${p.tab}`}
        role="tabpanel"
        aria-labelledby={`meetings-list-tab-${p.tab}`}
      >
        {p.loadFailed && (
          <div className="p-3">
            <Alert
              tone="error"
              action={
                <Button size="sm" onClick={p.onRetry}>
                  {k('retry')}
                </Button>
              }
            >
              {k('loadFailed')}
            </Alert>
          </div>
        )}
        {p.loading && (
          <p role="status" className="px-3.5 py-3 text-xs text-muted-foreground">
            {k('loading')}
          </p>
        )}
        {!p.loading && !total && !p.loadFailed && (
          <div className="px-3.5 py-6">
            <EmptyState
              title={
                p.query
                  ? k('noMatches', { query: p.query })
                  : k(p.tab === 'review' ? 'reviewEmpty' : 'empty')
              }
              description={
                p.query ? undefined : k(p.tab === 'review' ? 'reviewEmptyHint' : 'emptyHint')
              }
            />
          </div>
        )}
        {p.groups.map((group) => (
          <div key={group.id} role="group" aria-labelledby={`mh-group-${group.id}`}>
            <h2 id={`mh-group-${group.id}`} className="mh-group">
              {group.id === 'now' && anyLive && <span className="mh-live-dot" aria-hidden="true" />}
              {k(`groups.${group.id}`)}
            </h2>
            <ul>
              {group.rows.map((row) => (
                <li key={row.key}>
                  <RowButton row={row} {...p} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <OutlookFooter connection={p.outlook} onOpen={p.onOutlook} />
    </section>
  );
}

function RowButton({ row, ...p }: Props & { row: MeetingRow }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const selected = p.selectedKey === row.key;
  return (
    <button
      type="button"
      className="mh-row"
      data-key={row.key}
      aria-current={selected ? 'true' : undefined}
      onClick={() => p.onSelect(row)}
    >
      <b className="mh-row-title" data-row-title>
        {row.title || t('meetingsHub.untitled')}
      </b>
      <span className="mh-row-time">{rowTime(row.start, p.now, locale)}</span>
      <span className="mh-row-meta">
        <RowMeta row={row} live={p.isLive(row)} attention={p.attention(row)} now={p.now} />
      </span>
    </button>
  );
}

function RowMeta({
  row,
  live,
  attention,
  now,
}: {
  row: MeetingRow;
  live: boolean;
  attention: Attention;
  now: Date;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`meetingsHub.${key}`, options);
  const people = attendeesOf(row).length;
  const outlook =
    row.kind !== 'recording' && row.event
      ? people
        ? k('outlookPeople', { count: people })
        : k('outlook')
      : null;
  const endOfToday = nextDay(localDay(now.getFullYear(), now.getMonth(), now.getDate()));
  const started = !row.start || row.start < endOfToday;
  const parts: { text: string; tone?: 'live' | 'warning' }[] = [];
  const duration = scheduledMs(row);
  if (live && row.kind !== 'event') {
    return (
      <>
        <LiveBadge
          session={row.kind === 'session' ? row.session : { id: '', meeting_id: row.recording.id }}
        />
        {outlook && <span>{outlook}</span>}
      </>
    );
  }
  if (row.kind === 'event') {
    if (row.event.cancelled) parts.push({ text: k('cancelled') });
    else if (outlook) parts.push({ text: outlook });
    if (started && !row.event.cancelled) parts.push({ text: k('noRecording') });
  } else if (row.kind === 'recording') {
    parts.push({ text: k('recordingOnly') });
  } else {
    const hasRecording = !!row.session.meeting_id;
    if (hasRecording && duration) parts.push({ text: durationLabel(duration, t) });
    else if (outlook) parts.push({ text: outlook });
    if (!hasRecording && started) parts.push({ text: k('noRecording') });
  }
  if (attention === 'recover') parts.push({ text: k('interrupted'), tone: 'live' });
  if (attention === 'processing') parts.push({ text: k('transcribing') });
  if (attention === 'failed') parts.push({ text: k('transcriptFailed'), tone: 'live' });
  if (attention === 'untranscribed') parts.push({ text: k('noTranscript') });
  return (
    <>
      {parts.map((part) => (
        <span key={part.text} data-tone={part.tone}>
          {part.text}
        </span>
      ))}
    </>
  );
}

function OutlookFooter({
  connection,
  onOpen,
}: {
  connection: OutlookConnection;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) => t(`meetingsHub.${key}`, options);
  const synced = connection.snapshot.syncedAt ? new Date(connection.snapshot.syncedAt) : null;
  if (connection.error && !connection.busy)
    return (
      <footer className="mh-list-foot" role="alert">
        <span className="min-w-0 flex-1 truncate text-warning" title={connection.error}>
          {connection.error}
        </span>
        <Button variant="ghost" size="xs" onClick={connection.retry}>
          {k('retry')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<Settings2 size={13} aria-hidden="true" />}
          aria-label={k('outlookAccount')}
          title={k('outlookAccount')}
          onClick={onOpen}
        />
      </footer>
    );
  if (!connection.connected)
    return (
      <footer className="mh-list-foot">
        <Button
          variant="ghost"
          size="sm"
          icon={<CalendarDays size={14} aria-hidden="true" />}
          onClick={onOpen}
        >
          {connection.needsReconnect ? k('outlookReconnect') : k('outlookConnect')}
        </Button>
      </footer>
    );
  return (
    <footer className="mh-list-foot">
      <span className="mh-dot" data-tone="info" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {synced ? k('outlookSynced', { time: clockTime(synced, locale) }) : k('outlook')}
      </span>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        icon={<RefreshCw size={13} aria-hidden="true" />}
        aria-label={k('outlookSync')}
        title={k('outlookSync')}
        disabled={connection.busy}
        onClick={connection.sync}
      />
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        icon={<Settings2 size={13} aria-hidden="true" />}
        aria-label={k('outlookAccount')}
        title={k('outlookAccount')}
        onClick={onOpen}
      />
    </footer>
  );
}
