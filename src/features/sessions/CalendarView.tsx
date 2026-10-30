import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { Alert, Button, ButtonLink, EmptyState, PageHeader } from '../../components/ui';
import { sessions, useSessions } from './sessions';
import {
  dayKey,
  inPeriod,
  monthStart,
  parseCivilDate,
  periodRange,
  sessionDate,
} from './sessionDates';
import { matchesTranscript, useSessionNavigation } from './sessionNavigation';
import { CalendarMonth } from './CalendarMonth';
import { CalendarHelp } from './CalendarHelp';
import { CalendarToolbar, resetCalendarFilters } from './CalendarToolbar';
import { SessionEntry, SessionGroups } from './SessionList';
import './calendar.css';

export function CalendarView() {
  const { t, i18n } = useTranslation();
  const query = useSessions();
  const { calendarPeriod, month, selectedDay, view, transcript } = useSessionNavigation();
  const layout = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLElement>(null);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const matching = (query.data ?? []).filter((s) => matchesTranscript(s, transcript));
  const dated = matching.filter((s) => inPeriod(s, calendarPeriod));
  const undated = matching.filter((s) => !sessionDate(s));
  const shown = dated.filter((s) => monthStart(sessionDate(s)!.date).getTime() === month.getTime());
  const selected = selectedDay
    ? dated.filter((s) => dayKey(sessionDate(s)!.date) === selectedDay)
    : [];
  const date = selectedDay ? parseCivilDate(selectedDay) : null;
  const context = t('sessionCalendar.appliedPeriod', {
    period: t(`sessionCalendar.period.${calendarPeriod.kind}`),
    start: parseCivilDate(calendarPeriod.start ?? '')?.toLocaleDateString(locale) ?? '',
    end: parseCivilDate(calendarPeriod.end ?? '')?.toLocaleDateString(locale) ?? '',
  });
  function selectDay(day: string) {
    useSessionNavigation.setState({ selectedDay: day });
    requestAnimationFrame(() => {
      // Match the CSS content-container breakpoint, not the window width/sidebar state.
      if ((layout.current?.getBoundingClientRect().width ?? 0) < 920) {
        detail.current?.focus({ preventScroll: true });
        detail.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }
  function goToPeriod() {
    const first =
      periodRange(calendarPeriod)?.start ?? (dated[0] && sessionDate(dated[0])?.date) ?? new Date();
    useSessionNavigation.setState({ month: monthStart(first), selectedDay: null });
  }
  return (
    <div className="h-full overflow-auto bg-card">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="session-calendar space-y-5">
          <PageHeader
            title={t('sessionCalendar.title')}
            actions={
              <ButtonLink to="/agenda" icon={<CalendarDays size={16} aria-hidden="true" />}>
                {t('sessionCalendar.outlookAgenda')}
              </ButtonLink>
            }
          />
          {!sessions.available() ? (
            <Alert tone="info">{t('library.desktopRequired')}</Alert>
          ) : (
            <>
              <CalendarToolbar />
              <CalendarHelp />
              {query.isError && (
                <Alert
                  tone="error"
                  action={
                    <Button size="sm" onClick={() => void query.refetch()}>
                      {t('session.retry')}
                    </Button>
                  }
                >
                  {t('session.loadFailed')}
                </Alert>
              )}
              {query.isPending ? (
                <p role="status" className="text-ui text-muted-foreground">
                  {t('session.loading')}
                </p>
              ) : (
                query.data && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {t(
                          view === 'month'
                            ? 'sessionCalendar.legend'
                            : 'sessionCalendar.listContext'
                        )}
                      </span>
                      <a
                        className="cx-btn"
                        data-variant="ghost"
                        data-size="sm"
                        href="#calendar-undated"
                      >
                        {t('sessionCalendar.undatedCount', { count: undated.length })}
                      </a>
                    </div>
                    {!dated.length && !undated.length && (
                      <EmptyState
                        title={query.data.length ? t('sessionCalendar.empty') : t('session.empty')}
                      />
                    )}
                    {view === 'month' ? (
                      <>
                        {!shown.length && (
                          <Alert
                            tone="info"
                            action={
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" onClick={goToPeriod}>
                                  {t('sessionCalendar.goToPeriod')}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={resetCalendarFilters}>
                                  {t('sessionCalendar.reset')}
                                </Button>
                              </div>
                            }
                          >
                            {dated.length
                              ? t('sessionCalendar.outsideMonth', { count: dated.length })
                              : t('sessionCalendar.monthEmpty')}
                          </Alert>
                        )}
                        <a
                          className="sr-only focus:not-sr-only focus:inline-flex focus:w-fit focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-ui"
                          href="#calendar-day-detail"
                        >
                          {t('sessionCalendar.skipDays')}
                        </a>
                        <div ref={layout} className="calendar-day-layout">
                          <CalendarMonth
                            month={month}
                            rows={dated}
                            selectedDay={selectedDay}
                            onSelect={selectDay}
                          />
                          <section
                            ref={detail}
                            id="calendar-day-detail"
                            tabIndex={-1}
                            aria-label={t('sessionCalendar.dayDetail')}
                            className="calendar-day-detail space-y-2 rounded-md border border-border bg-background p-4 focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <h2 className="text-sm font-semibold" aria-live="polite">
                              {date
                                ? date.toLocaleDateString(locale, { dateStyle: 'full' })
                                : t('sessionCalendar.selectDay')}
                            </h2>
                            <p className="text-xs text-muted-foreground">{context}</p>
                            {date &&
                              (selected.length ? (
                                <div className="space-y-2">
                                  {selected.map((s) => (
                                    <SessionEntry key={s.id} session={s} />
                                  ))}
                                </div>
                              ) : (
                                <p className="text-ui text-muted-foreground">
                                  {t('sessionCalendar.dayEmpty')}
                                </p>
                              ))}
                          </section>
                        </div>
                      </>
                    ) : (
                      <section aria-label={t('sessionCalendar.viewlist')}>
                        <SessionGroups rows={dated} />
                      </section>
                    )}
                    <section
                      id="calendar-undated"
                      tabIndex={-1}
                      className="space-y-2 border-t border-border pt-4 focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={t('sessionCalendar.undated')}
                    >
                      <h2 className="text-sm font-semibold">
                        {t('sessionCalendar.undatedCount', { count: undated.length })}
                      </h2>
                      {undated.length ? (
                        <div className="space-y-2">
                          {undated.map((s) => (
                            <SessionEntry key={s.id} session={s} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t('sessionCalendar.undatedEmpty')}
                        </p>
                      )}
                    </section>
                  </>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
