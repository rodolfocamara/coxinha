import { useTranslation } from 'react-i18next';
import type { Session } from './sessions';
import { dayKey, monthWeeks, sessionDate } from './sessionDates';
import { transcriptStatus } from './sessionNavigation';

/** Semantic table with native day buttons. Every session is reachable through its day list. */
export function CalendarMonth({
  month,
  rows,
  selectedDay,
  onSelect,
}: {
  month: Date;
  rows: Session[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const weeks = monthWeeks(month);
  const today = dayKey(new Date());
  const byDay = new Map<string, Session[]>();
  for (const row of rows) {
    const date = sessionDate(row);
    if (date) {
      const key = dayKey(date.date);
      byDay.set(key, [...(byDay.get(key) ?? []), row]);
    }
  }
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">
        {month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}.{' '}
        {t('sessionCalendar.gridHelp')}
      </caption>
      <thead>
        <tr>
          {weeks[0].map((date) => (
            <th
              key={date.getDay()}
              scope="col"
              className="py-1.5 text-center text-xs font-medium text-muted-foreground"
            >
              <abbr
                className="no-underline"
                title={date.toLocaleDateString(locale, { weekday: 'long' })}
              >
                {date.toLocaleDateString(locale, { weekday: 'short' })}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={dayKey(week[0])}>
            {week.map((date) => {
              const key = dayKey(date);
              if (date.getMonth() !== month.getMonth())
                return <td key={key} className="border border-border bg-secondary/20" />;
              const sessions = byDay.get(key) ?? [];
              const available = sessions.filter((s) => transcriptStatus(s) === 'available').length;
              const without = sessions.filter((s) =>
                ['none', 'empty'].includes(transcriptStatus(s))
              ).length;
              const uncertain = sessions.length - available - without;
              const label = `${date.toLocaleDateString(locale, { dateStyle: 'full' })}. ${t('sessionCalendar.meetingCount', { count: sessions.length })}. ${t('sessionCalendar.coverage', { available, without, uncertain })}`;
              return (
                <td key={key} className="border border-border align-top p-0">
                  <button
                    type="button"
                    aria-label={label}
                    aria-controls="calendar-day-detail"
                    aria-pressed={selectedDay === key}
                    aria-current={key === today ? 'date' : undefined}
                    className="w-full min-h-16 p-1.5 text-left align-top hover:bg-secondary aria-pressed:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    onClick={() => onSelect(key)}
                  >
                    <span
                      className={`inline-flex w-6 h-6 items-center justify-center rounded-full ${key === today ? 'bg-primary text-primary-foreground' : ''}`}
                    >
                      {date.getDate()}
                    </span>
                    {!!sessions.length && (
                      <>
                        <span
                          title={t('sessionCalendar.meetingCount', { count: sessions.length })}
                          aria-hidden="true"
                          className="ml-1 text-xs text-muted-foreground"
                        >
                          {sessions.length}
                        </span>
                        <span
                          aria-hidden="true"
                          className="block mt-1 text-xs text-muted-foreground break-words"
                        >
                          {t('sessionCalendar.shortCoverage', { available, without, uncertain })}
                        </span>
                      </>
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
