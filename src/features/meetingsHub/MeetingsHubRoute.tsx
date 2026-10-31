import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, EmptyState, Sheet } from '../../components/ui';
import { library } from '../meetings/library';
import { OutlookConnectionCard } from '../agenda/OutlookConnectionCard';
import type { CalendarEvent } from '../agenda/calendar';
import {
  attentionOf,
  groupRows,
  matchesSearch,
  needsReview,
  rowKey,
  type MeetingRow,
} from './meetingRows';
import { MeetingList, type ListTab } from './MeetingList';
import { MeetingDetail, type DetailTarget } from './MeetingDetail';
import { MonthView } from './MonthView';
import { NewMeetingSheet } from './NewMeetingSheet';
import { ImportAudioSheet } from './ImportAudioSheet';
import { ParticipantsSheet } from './ParticipantsSheet';
import { useMeetingsData, useRowLiveness } from './useMeetingsData';
import {
  IMPORT_AUDIO_EVENT,
  NEW_MEETING_EVENT,
  takePendingSheet,
  type MeetingsSheet,
} from './meetingsSheets';
import { validateMeetingsSearch } from './meetingsSearch';
import './meetingsHub.css';

type SheetState =
  | { kind: 'meeting' }
  | { kind: 'import'; title: string; forMeeting: boolean }
  | { kind: 'outlook' }
  | { kind: 'participants'; meetingId: string; event: CalendarEvent | null }
  | null;

const sheetFor = (sheet: MeetingsSheet): SheetState =>
  sheet === 'meeting' ? { kind: 'meeting' } : { kind: 'import', title: '', forMeeting: false };

/**
 * Reuniões (spec 0096 P4): one list merging meeting sessions, Outlook events
 * and loose recordings, with detail + inspector or the month grid beside it.
 * Replaces the calendar, the Outlook agenda, the meeting library and the
 * session workspace.
 */
export function MeetingsHubRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const search = validateMeetingsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const tab: ListTab = search.tab ?? 'list';
  const { sessions, outlook, recordings, rows, refreshRecordings } = useMeetingsData();
  const isLive = useRowLiveness();
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [participantsRevision, setParticipantsRevision] = useState(0);
  const desktop = library.available();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const pending = takePendingSheet();
    if (pending) setSheet(sheetFor(pending));
    const onNew = () => {
      takePendingSheet();
      setSheet(sheetFor('meeting'));
    };
    const onImport = () => {
      takePendingSheet();
      setSheet(sheetFor('import'));
    };
    window.addEventListener(NEW_MEETING_EVENT, onNew);
    window.addEventListener(IMPORT_AUDIO_EVENT, onImport);
    return () => {
      window.removeEventListener(NEW_MEETING_EVENT, onNew);
      window.removeEventListener(IMPORT_AUDIO_EVENT, onImport);
    };
  }, []);

  const attention = (row: MeetingRow) => attentionOf(row, isLive(row));
  const searched = rows.filter((row) => matchesSearch(row, query));
  const review = searched.filter((row) => needsReview(attention(row)));
  const reviewCount = rows.filter((row) => needsReview(attention(row))).length;
  const groups =
    tab === 'review'
      ? review.length
        ? [{ id: 'review' as const, rows: review }]
        : []
      : groupRows(searched, now, isLive);
  const firstRow = groups[0]?.rows[0] ?? null;

  const target = useMemo<DetailTarget | null>(() => {
    const toTarget = (row: MeetingRow | null | undefined): DetailTarget | null =>
      !row
        ? null
        : row.kind === 'session'
          ? { kind: 'session', sessionId: row.session.id, row }
          : row.kind === 'event'
            ? { kind: 'event', row }
            : { kind: 'recording', row };
    if (sessionId) {
      const row = rows.find((r) => r.key === rowKey.session(sessionId));
      return { kind: 'session', sessionId, row: row?.kind === 'session' ? row : null };
    }
    if (search.event)
      return toTarget(
        rows.find((r) => r.key === rowKey.event(search.event!)) ??
          rows.find((r) => r.kind === 'session' && r.event?.id === search.event)
      );
    if (search.recording)
      return toTarget(
        rows.find((r) => r.key === rowKey.recording(search.recording!)) ??
          rows.find((r) => r.kind === 'session' && r.session.meeting_id === search.recording)
      );
    return toTarget(firstRow);
  }, [rows, sessionId, search.event, search.recording, firstRow]);
  const selectedKey = !target
    ? null
    : target.kind === 'session'
      ? rowKey.session(target.sessionId)
      : target.row.key;

  const listTab = (next: ListTab) => (next === 'list' ? undefined : next);
  const select = (row: MeetingRow, keepTab = true) => {
    const nextTab = keepTab && tab === 'review' ? 'review' : undefined;
    if (row.kind === 'session')
      void navigate({
        to: '/meetings/$sessionId',
        params: { sessionId: row.session.id },
        search: { tab: nextTab },
      });
    else
      void navigate({
        to: '/meetings',
        search:
          row.kind === 'event'
            ? { tab: nextTab, event: row.event.id }
            : { tab: nextTab, recording: row.recording.id },
      });
  };
  const openSession = (id: string) =>
    void navigate({ to: '/meetings/$sessionId', params: { sessionId: id }, search: {} });
  const changeTab = (next: ListTab) => {
    const nextSearch = { ...search, tab: listTab(next) };
    if (sessionId)
      void navigate({ to: '/meetings/$sessionId', params: { sessionId }, search: nextSearch });
    else void navigate({ to: '/meetings', search: nextSearch });
  };
  const closeSheet = (open: boolean) => {
    if (open) return;
    if (sheet?.kind === 'participants') setParticipantsRevision((n) => n + 1);
    setSheet(null);
  };
  const upcomingEvents = rows
    .filter((r): r is Extract<MeetingRow, { kind: 'event' }> => r.kind === 'event')
    .filter((r) => !r.event.cancelled && (!r.end || r.end > now))
    .map((r) => r.event);

  return (
    <div className="mh-root">
      <MeetingList
        groups={groups}
        reviewCount={reviewCount}
        tab={tab}
        onTab={changeTab}
        query={query}
        onQuery={setQuery}
        selectedKey={tab === 'month' ? null : selectedKey}
        onSelect={select}
        onNew={() => setSheet({ kind: 'meeting' })}
        onImport={() => setSheet({ kind: 'import', title: '', forMeeting: false })}
        onOutlook={() => setSheet({ kind: 'outlook' })}
        outlook={outlook}
        isLive={isLive}
        attention={attention}
        now={now}
        loadFailed={sessions.isError && !sessions.data}
        loading={desktop && sessions.isPending}
        onRetry={() => {
          void sessions.refetch();
          void recordings.refetch();
        }}
        desktop={desktop}
      />
      {!desktop ? (
        <div className="mh-detail p-6">
          <Alert tone="info">{t('meetingsHub.desktopRequired')}</Alert>
        </div>
      ) : tab === 'month' ? (
        <MonthView rows={rows} now={now} isLive={isLive} onSelect={(row) => select(row, false)} />
      ) : target ? (
        <MeetingDetail
          key={selectedKey}
          target={target}
          events={outlook.snapshot.events}
          now={now}
          onOpenSession={openSession}
          onImport={(title) => setSheet({ kind: 'import', title, forMeeting: true })}
          onParticipants={(meetingId, event) =>
            setSheet({ kind: 'participants', meetingId, event })
          }
          participantsRevision={participantsRevision}
        />
      ) : (
        <div className="mh-detail grid place-items-center p-6">
          <EmptyState
            title={t('meetingsHub.noSelection')}
            description={t('meetingsHub.noSelectionHint')}
          />
        </div>
      )}
      {sheet?.kind === 'meeting' && (
        <NewMeetingSheet
          open
          onOpenChange={closeSheet}
          events={upcomingEvents}
          now={now}
          onCreated={(id) => {
            setSheet(null);
            openSession(id);
          }}
        />
      )}
      {sheet?.kind === 'import' && (
        <ImportAudioSheet
          open
          onOpenChange={closeSheet}
          initialTitle={sheet.title}
          forMeeting={sheet.forMeeting}
          onImported={(meetingId) => {
            setSheet(null);
            void refreshRecordings();
            void navigate({ to: '/meetings', search: { recording: meetingId } });
          }}
        />
      )}
      {sheet?.kind === 'participants' && (
        <ParticipantsSheet
          open
          onOpenChange={closeSheet}
          meetingId={sheet.meetingId}
          event={sheet.event}
        />
      )}
      {sheet?.kind === 'outlook' && (
        <Sheet
          open
          onOpenChange={closeSheet}
          title={t('meetingsHub.outlookSheet.title')}
          description={t('meetingsHub.outlookSheet.description')}
          closeLabel={t('meetingsHub.close')}
        >
          <OutlookConnectionCard connection={outlook} />
        </Sheet>
      )}
    </div>
  );
}
