import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, EmptyState, Sheet } from '../../components/ui';
import { library } from '../meetings/library';
import { OutlookConnectionCard } from '../agenda/OutlookConnectionCard';
import type { CalendarEvent } from '../agenda/calendar';
import { attentionOf, needsReview, rowKey, type MeetingRow } from './meetingRows';
import type { DetailTarget } from './MeetingDetail';
import { MeetingPage } from './MeetingPage';
import { CalendarHome } from './CalendarHome';
import { ReviewSheet } from './ReviewSheet';
import { readCalendarPrefs, writeCalendarPrefs, type CalendarView } from './calendarViews';
import { NewMeetingSheet } from './NewMeetingSheet';
import { ImportAudioSheet } from './ImportAudioSheet';
import { ParticipantsSheet } from './ParticipantsSheet';
import { CalendarMatchBanner, CalendarMatchSheet, useCalendarMatches } from './CalendarMatches';
import { useMeetingsData, useRowLiveness } from './useMeetingsData';
import {
  IMPORT_AUDIO_EVENT,
  NEW_MEETING_EVENT,
  OUTLOOK_SHEET_EVENT,
  takePendingSheet,
  type MeetingsSheet,
} from './meetingsSheets';
import { validateMeetingsSearch, type DetailPanel, type MeetingsSearch } from './meetingsSearch';
import './meetingsHub.css';

type SheetState =
  | { kind: 'meeting'; slot?: { start: Date; end: Date } }
  | { kind: 'import'; title: string; forMeeting: boolean }
  | { kind: 'outlook' }
  | { kind: 'calendar' }
  | { kind: 'review' }
  | { kind: 'participants'; meetingId: string; event: CalendarEvent | null }
  | null;

const sheetFor = (sheet: MeetingsSheet): SheetState =>
  sheet === 'import' ? { kind: 'import', title: '', forMeeting: false } : { kind: sheet };

/**
 * Reuniões (spec 0107): the calendar, Outlook-style, with a meeting's full
 * page when one is addressed (`/meetings/$sessionId`, `?event=`,
 * `?recording=`). Sheets for new meetings, imports, Outlook, calendar matches
 * and review sit over both.
 */
export function MeetingsHubRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const search = validateMeetingsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const { sessions, outlook, recordings, rows, refreshRecordings } = useMeetingsData();
  const isLive = useRowLiveness();
  const [now, setNow] = useState(() => new Date());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [participantsRevision, setParticipantsRevision] = useState(0);
  const desktop = library.available();
  const calendarMatches = useCalendarMatches(desktop);

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
    const onOutlook = () => {
      takePendingSheet();
      setSheet(sheetFor('outlook'));
    };
    window.addEventListener(NEW_MEETING_EVENT, onNew);
    window.addEventListener(IMPORT_AUDIO_EVENT, onImport);
    window.addEventListener(OUTLOOK_SHEET_EVENT, onOutlook);
    return () => {
      window.removeEventListener(NEW_MEETING_EVENT, onNew);
      window.removeEventListener(IMPORT_AUDIO_EVENT, onImport);
      window.removeEventListener(OUTLOOK_SHEET_EVENT, onOutlook);
    };
  }, []);
  // The old review tab and `?review` open the sheet over the calendar.
  useEffect(() => {
    if (!search.review) return;
    setSheet({ kind: 'review' });
    void navigate({ to: '/meetings', search: { ...search, review: undefined }, replace: true });
    // Only the flag arriving matters; the rest of the search is carried along.
  }, [search.review]);

  const attention = (row: MeetingRow) => attentionOf(row, isLive(row));
  const review = rows.filter((row) => needsReview(attention(row)));

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
    return null;
  }, [rows, sessionId, search.event, search.recording]);
  const addressed = !!sessionId || !!search.event || !!search.recording;

  // The URL names the view; without one, the last view chosen (spec 0104 P4).
  const remembered = readCalendarPrefs();
  const view = search.view ?? remembered.view;
  const days = search.days ?? remembered.days;
  const calendarSearch = (): MeetingsSearch => ({ view: search.view, days: search.days });
  const open = (row: MeetingRow, panel?: DetailPanel) => {
    const base = { ...calendarSearch(), panel };
    if (row.kind === 'session')
      void navigate({
        to: '/meetings/$sessionId',
        params: { sessionId: row.session.id },
        search: base,
      });
    else
      void navigate({
        to: '/meetings',
        search:
          row.kind === 'event'
            ? { ...base, event: row.event.id }
            : { ...base, recording: row.recording.id },
      });
  };
  const openSession = (id: string) =>
    void navigate({
      to: '/meetings/$sessionId',
      params: { sessionId: id },
      search: calendarSearch(),
    });
  const changeView = (next: CalendarView, count: number) => {
    writeCalendarPrefs({ view: next, days: count });
    void navigate({
      to: '/meetings',
      search: { view: next, days: next === 'day' ? count : undefined },
    });
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
      {!desktop ? (
        <div className="mh-detail p-6">
          <Alert tone="info">{t('meetingsHub.desktopRequired')}</Alert>
        </div>
      ) : addressed && target ? (
        <MeetingPage
          key={target.kind === 'session' ? target.sessionId : target.row.key}
          target={target}
          events={outlook.snapshot.events}
          now={now}
          initialTab={search.panel}
          onBack={() => void navigate({ to: '/meetings', search: calendarSearch() })}
          onOpenSession={openSession}
          onImport={(title) => setSheet({ kind: 'import', title, forMeeting: true })}
          onParticipants={(meetingId, event) =>
            setSheet({ kind: 'participants', meetingId, event })
          }
          participantsRevision={participantsRevision}
        />
      ) : addressed ? (
        <div className="mh-detail grid place-items-center p-6">
          {sessions.isPending || recordings.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('meetingsHub.loading')}
            </p>
          ) : (
            <EmptyState
              title={t('meetingsHub.noSelection')}
              description={t('meetingsHub.noSelectionHint')}
            />
          )}
        </div>
      ) : (
        <CalendarHome
          rows={rows}
          now={now}
          isLive={isLive}
          view={view}
          days={days}
          onView={changeView}
          outlook={outlook}
          reviewCount={review.length}
          onReview={() => setSheet({ kind: 'review' })}
          onNew={(slot) => setSheet({ kind: 'meeting', slot })}
          onImport={() => setSheet({ kind: 'import', title: '', forMeeting: false })}
          onOutlook={() => setSheet({ kind: 'outlook' })}
          onOpen={open}
          onOpenSession={openSession}
          desktop={desktop}
          loadFailed={sessions.isError && !sessions.data}
          onRetry={() => {
            void sessions.refetch();
            void recordings.refetch();
          }}
          banner={
            <CalendarMatchBanner
              count={calendarMatches.matches.length}
              onReview={() => setSheet({ kind: 'calendar' })}
            />
          }
        />
      )}
      {sheet?.kind === 'review' && (
        <ReviewSheet
          open
          onOpenChange={closeSheet}
          rows={review}
          now={now}
          isLive={isLive}
          attention={attention}
          onOpen={(row) => {
            setSheet(null);
            open(row);
          }}
        />
      )}
      {sheet?.kind === 'meeting' && (
        <NewMeetingSheet
          open
          onOpenChange={closeSheet}
          events={upcomingEvents}
          now={now}
          initial={sheet.slot}
          onReconnect={() => setSheet({ kind: 'outlook' })}
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
      {sheet?.kind === 'calendar' && (
        <CalendarMatchSheet
          open
          onOpenChange={closeSheet}
          matches={calendarMatches.matches}
          onResolved={calendarMatches.reload}
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
