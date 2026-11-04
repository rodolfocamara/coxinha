import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import type { CalendarMatch } from '../meetings/library';
import type { CalendarEvent } from '../agenda/calendar';
import { useOutlookCategories } from '../agenda/categories';
import type { OutlookConnection } from '../agenda/useOutlookConnection';
import { rowKey, type MeetingRow } from './meetingRows';
import { CalendarMatchBanner } from './CalendarMatches';
import { stepAnchor, viewRange, type CalendarView } from './calendarViews';
import { CalendarGrid, rangeLabel } from './CalendarPage';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarRail } from './CalendarRail';
import { NowStrip } from './NowStrip';
import { MeetingPeek } from './MeetingPeek';
import { useCalendarHome, visibleRows } from './calendarHomeModel';
import { useCalendarKeys } from './useCalendarKeys';
import type { DetailPanel } from './meetingsSearch';
import './calendarHome.css';

type Props = {
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  view: CalendarView;
  days: number;
  onView: (view: CalendarView, days: number) => void;
  outlook: OutlookConnection;
  reviewCount: number;
  onReview: () => void;
  onNew: (slot?: { start: Date; end: Date }) => void;
  onImport: () => void;
  onOutlook: () => void;
  onOpen: (row: MeetingRow, panel?: DetailPanel) => void;
  onOpenSession: (sessionId: string) => void;
  desktop: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  events: CalendarEvent[];
  /** Recordings that look like calendar meetings (spec 0100), answered in the peek. */
  matches: CalendarMatch[];
  onMatchResolved: () => void;
};

/**
 * Reuniões is the calendar (spec 0107): Outlook's views at full width, what
 * is happening now, a rail to jump and filter, and a peek beside the grid.
 */
export function CalendarHome(p: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const stored = useCalendarHome((s) => s.anchor);
  const setAnchor = useCalendarHome((s) => s.setAnchor);
  const hidden = useCalendarHome((s) => s.hidden);
  const master = useOutlookCategories((s) => s.master);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [matchEvent, setMatchEvent] = useState<string | null>(null);
  const anchor = stored ?? p.now;
  const range = viewRange(p.view, anchor, p.days);
  const shown = visibleRows(p.rows, hidden, master);
  const selected = selectedKey ? (p.rows.find((r) => r.key === selectedKey) ?? null) : null;
  const matchRow = matchEvent
    ? p.rows.find((r) => r.kind !== 'recording' && r.event?.id === matchEvent)
    : undefined;
  const focusKeys = selected && matchRow ? [selected.key, matchRow.key] : null;

  const close = useCallback(() => {
    const key = selectedKey;
    setSelectedKey(null);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`.ch-body [data-key="${CSS.escape(key ?? '')}"]`)?.focus()
    );
  }, [selectedKey]);
  useCalendarKeys({
    today: () => setAnchor(p.now),
    move: (direction) => setAnchor(stepAnchor(p.view, anchor, p.days, direction)),
    view: (view) => p.onView(view, p.days),
    create: () => p.onNew(),
    canCreate: p.desktop,
  });
  const step = p.view === 'day' ? 'Day' : p.view === 'month' ? 'Month' : 'Week';
  const stepOptions = p.view === 'day' ? { count: p.days } : undefined;

  return (
    <div className="ch-root">
      <CalendarToolbar
        view={p.view}
        days={p.days}
        onView={p.onView}
        label={rangeLabel(p.view, range.first, range.last, locale)}
        previousLabel={t(`meetingsHub.calendar.previous${step}`, stepOptions)}
        nextLabel={t(`meetingsHub.calendar.next${step}`, stepOptions)}
        onToday={() => setAnchor(p.now)}
        onStep={(direction) => setAnchor(stepAnchor(p.view, anchor, p.days, direction))}
        onNew={() => p.onNew()}
        onImport={p.onImport}
        desktop={p.desktop}
      />
      <NowStrip
        rows={p.rows}
        now={p.now}
        isLive={p.isLive}
        onSelect={(row) => setSelectedKey(row.key)}
        onOpen={(row) => p.onOpen(row)}
        onOpenSession={p.onOpenSession}
      />
      {p.loadFailed && (
        <div className="ch-alert">
          <Alert
            tone="error"
            action={
              <Button
                size="sm"
                onClick={p.onRetry}
                icon={<RotateCw size={14} aria-hidden="true" />}
              >
                {t('meetingsHub.retry')}
              </Button>
            }
          >
            {t('meetingsHub.loadFailed')}
          </Alert>
        </div>
      )}
      <div className="ch-body" data-peek={!!selected || undefined}>
        <CalendarRail
          anchor={anchor}
          first={range.first}
          last={range.last}
          now={p.now}
          onPick={setAnchor}
          reviewCount={p.reviewCount}
          onReview={p.onReview}
          outlook={p.outlook}
          onOutlook={p.onOutlook}
          banner={
            <CalendarMatchBanner
              count={p.matches.length}
              onReview={() => {
                const first = p.matches[0];
                if (!first) return;
                setAnchor(new Date(first.startsAt));
                setSelectedKey(rowKey.session(first.sessionId));
              }}
            />
          }
        />
        <div className="ch-main">
          <CalendarGrid
            view={p.view}
            days={p.days}
            anchor={anchor}
            rows={shown}
            now={p.now}
            isLive={p.isLive}
            selectedKey={selectedKey}
            focusKeys={focusKeys}
            onSelect={(row) => setSelectedKey(row.key)}
            onOpen={(row) => p.onOpen(row)}
            onCreate={p.desktop ? (start, end) => p.onNew({ start, end }) : undefined}
          />
        </div>
        {selected && (
          <MeetingPeek
            key={selected.key}
            row={selected}
            now={p.now}
            live={p.isLive(selected)}
            onClose={close}
            onOpen={p.onOpen}
            onOpenSession={p.onOpenSession}
            events={p.events}
            matches={p.matches}
            onMatchResolved={(kept) => {
              if (kept) setSelectedKey(rowKey.session(kept));
              p.onMatchResolved();
            }}
            onMatchFocus={setMatchEvent}
          />
        )}
      </div>
    </div>
  );
}
