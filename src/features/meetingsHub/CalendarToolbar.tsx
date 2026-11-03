import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Search, Upload } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import type { CalendarView } from './calendarViews';
import { ViewSwitcher } from './ViewSwitcher';

type Props = {
  view: CalendarView;
  days: number;
  onView: (view: CalendarView, days: number) => void;
  label: string;
  previousLabel: string;
  nextLabel: string;
  onToday: () => void;
  onStep: (direction: 1 | -1) => void;
  query: string;
  onQuery: (query: string) => void;
  resultCount: number | null;
  onNew: () => void;
  onImport: () => void;
  desktop: boolean;
};

/** Outlook's calendar bar (spec 0107); while searching, the way back replaces paging. */
export function CalendarToolbar(p: Props) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.home.${key}`, options);
  const searching = !!p.query.trim();
  return (
    <header className="ch-bar">
      <h1 className="sr-only">{t('meetingsHub.title')}</h1>
      <Button
        variant="primary"
        size="sm"
        icon={<Plus size={14} aria-hidden="true" />}
        disabled={!p.desktop}
        onClick={p.onNew}
      >
        {k('newMeeting')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<Upload size={15} aria-hidden="true" />}
        aria-label={t('meetingsHub.importAudio')}
        title={t('meetingsHub.importAudio')}
        disabled={!p.desktop}
        onClick={p.onImport}
      />
      <span className="ch-sep" aria-hidden="true" />
      {searching ? (
        <>
          <Button
            size="sm"
            icon={<ArrowLeft size={14} aria-hidden="true" />}
            onClick={() => p.onQuery('')}
          >
            {k('backToCalendar')}
          </Button>
          {p.resultCount !== null && (
            <span className="text-sm text-muted-foreground" role="status">
              {k('results', { count: p.resultCount })}
            </span>
          )}
        </>
      ) : (
        <>
          <Button size="sm" onClick={p.onToday}>
            {t('meetingsHub.calendar.today')}
          </Button>
          <Button
            size="sm"
            iconOnly
            icon={<ChevronLeft size={15} aria-hidden="true" />}
            aria-label={p.previousLabel}
            onClick={() => p.onStep(-1)}
          />
          <Button
            size="sm"
            iconOnly
            icon={<ChevronRight size={15} aria-hidden="true" />}
            aria-label={p.nextLabel}
            onClick={() => p.onStep(1)}
          />
          <h2 className="ch-title" aria-live="polite">
            {p.label}
          </h2>
        </>
      )}
      <span className="flex-1" />
      <div className="ch-search">
        <Search size={14} aria-hidden="true" className="ch-search-icon" />
        <Input
          size="sm"
          type="search"
          value={p.query}
          aria-label={k('search')}
          placeholder={k('search')}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && p.query) {
              e.preventDefault();
              p.onQuery('');
            }
          }}
        />
      </div>
      {!searching && <ViewSwitcher view={p.view} days={p.days} onChange={p.onView} />}
    </header>
  );
}
