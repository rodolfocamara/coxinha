import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { library, type CalendarMatch } from '../meetings/library';
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
import { SearchResults } from './SearchResults';
import { useCalendarHome, visibleRows } from './calendarHome';
import { filterResults, mergeResults, NO_FILTERS, type ResultFilters } from './searchResults';
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
 * A search replaces the grid with results; no meeting is shown twice.
 */
export function CalendarHome(p: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const stored = useCalendarHome((s) => s.anchor);
  const setAnchor = useCalendarHome((s) => s.setAnchor);
  const hidden = useCalendarHome((s) => s.hidden);
  const query = useCalendarHome((s) => s.query);
  const setQuery = useCalendarHome((s) => s.setQuery);
  const master = useOutlookCategories((s) => s.master);
  const [filters, setFilters] = useState<ResultFilters>(NO_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const anchor = stored ?? p.now;
  const range = viewRange(p.view, anchor, p.days);
  const shown = visibleRows(p.rows, hidden, master);
  const searching = !!query.trim();
  const debounced = useDebounced(query.trim(), 250);
  const remote = useQuery({
    queryKey: ['library-search', debounced],
    queryFn: () => library.search(debounced).catch(() => []),
    enabled: debounced.length >= 2 && library.available(),
    retry: false,
  });
  const all = searching ? mergeResults(shown, query, remote.data ?? []) : [];
  const results = filterResults(all, filters, p.now);
  const selected = selectedKey ? (p.rows.find((r) => r.key === selectedKey) ?? null) : null;

  const changeQuery = (next: string) => {
    setQuery(next);
    if (!next.trim()) setFilters(NO_FILTERS);
  };
  const close = useCallback(() => {
    const key = selectedKey;
    setSelectedKey(null);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`.ch-body [data-key="${CSS.escape(key ?? '')}"]`)?.focus()
    );
  }, [selectedKey]);
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
        query={query}
        onQuery={changeQuery}
        resultCount={searching && !(remote.isFetching && !results.length) ? results.length : null}
        onNew={() => p.onNew()}
        onImport={p.onImport}
        desktop={p.desktop}
      />
      {!searching && (
        <NowStrip
          rows={p.rows}
          now={p.now}
          isLive={p.isLive}
          onSelect={(row) => setSelectedKey(row.key)}
          onOpen={(row) => p.onOpen(row)}
          onOpenSession={p.onOpenSession}
        />
      )}
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
          onPick={(day) => {
            setAnchor(day);
            if (searching) changeQuery('');
          }}
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
                if (searching) changeQuery('');
                setAnchor(new Date(first.startsAt));
                setSelectedKey(rowKey.session(first.sessionId));
              }}
            />
          }
        />
        <div className="ch-main">
          {searching ? (
            <SearchResults
              query={query}
              results={results}
              all={all}
              filters={filters}
              onFilters={setFilters}
              searching={remote.isFetching || debounced !== query.trim()}
              now={p.now}
              selectedKey={selectedKey}
              onSelect={(row) => setSelectedKey(row.key)}
              onOpen={(row) => p.onOpen(row)}
            />
          ) : (
            <CalendarGrid
              view={p.view}
              days={p.days}
              anchor={anchor}
              rows={shown}
              now={p.now}
              isLive={p.isLive}
              selectedKey={selectedKey}
              onSelect={(row) => setSelectedKey(row.key)}
              onOpen={(row) => p.onOpen(row)}
              onCreate={p.desktop ? (start, end) => p.onNew({ start, end }) : undefined}
            />
          )}
        </div>
        {selected && (
          <MeetingPeek
            key={selected.key}
            row={selected}
            now={p.now}
            query={query}
            live={p.isLive(selected)}
            onClose={close}
            onOpen={p.onOpen}
            onOpenSession={p.onOpenSession}
            events={p.events}
            matches={p.matches}
            onMatchResolved={p.onMatchResolved}
          />
        )}
      </div>
    </div>
  );
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
