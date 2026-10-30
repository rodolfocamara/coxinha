import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { Button, Field, Select } from '../../components/ui';
import { dayKey, monthStart, periodRange, type Period } from './sessionDates';
import { useSessionNavigation, type TranscriptFilter } from './sessionNavigation';
import { PeriodSelector } from './PeriodSelector';

export function applyCalendarPeriod(calendarPeriod: Period) {
  const range = periodRange(calendarPeriod);
  useSessionNavigation.setState({
    calendarPeriod,
    month: monthStart(range?.start ?? new Date()),
    selectedDay: null,
  });
}
export function resetCalendarFilters() {
  applyCalendarPeriod({ kind: 'all' });
  useSessionNavigation.setState({ transcript: 'all' });
}

/** Filters on one bottom-aligned row; month navigation and view on the next (spec 0095). */
export function CalendarToolbar() {
  const { t, i18n } = useTranslation();
  const { calendarPeriod, transcript, month, view } = useSessionNavigation();
  function moveMonth(next: Date, today = false) {
    useSessionNavigation.setState({
      month: monthStart(next),
      selectedDay: today ? dayKey(new Date()) : null,
    });
  }
  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label={t('sessionCalendar.filters')}
        data-testid="calendar-filters"
        className="flex flex-wrap items-end gap-3"
      >
        <PeriodSelector
          label={t('sessionCalendar.calendarPeriod')}
          period={calendarPeriod}
          onChange={applyCalendarPeriod}
        />
        <Field label={t('sessionCalendar.transcriptFilter')} className="min-w-44">
          <Select
            block
            value={transcript}
            onChange={(e) =>
              useSessionNavigation.setState({ transcript: e.target.value as TranscriptFilter })
            }
          >
            {(['all', 'available', 'without'] as const).map((id) => (
              <option key={id} value={id}>
                {t(`sessionCalendar.filter.${id}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="ghost"
          icon={<RotateCcw size={14} aria-hidden="true" />}
          onClick={resetCalendarFilters}
        >
          {t('sessionCalendar.reset')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight capitalize" aria-live="polite">
          {month.toLocaleDateString(i18n.resolvedLanguage ?? i18n.language, {
            month: 'long',
            year: 'numeric',
          })}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              iconOnly
              aria-label={t('sessionCalendar.previous')}
              icon={<ChevronLeft size={16} aria-hidden="true" />}
              disabled={month.getFullYear() === 1 && month.getMonth() === 0}
              onClick={() => moveMonth(monthStart(month, -1))}
            />
            <Button size="sm" onClick={() => moveMonth(new Date(), true)}>
              {t('sessionCalendar.today')}
            </Button>
            <Button
              size="sm"
              iconOnly
              aria-label={t('sessionCalendar.next')}
              icon={<ChevronRight size={16} aria-hidden="true" />}
              disabled={month.getFullYear() === 9999 && month.getMonth() === 11}
              onClick={() => moveMonth(monthStart(month, 1))}
            />
          </div>
          <div
            role="group"
            aria-label={t('sessionCalendar.view')}
            className="flex rounded-sm border border-border p-0.5"
          >
            {(['month', 'list'] as const).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="sm"
                className="h-7 aria-pressed:bg-secondary aria-pressed:text-foreground"
                aria-pressed={view === mode}
                onClick={() => useSessionNavigation.setState({ view: mode })}
              >
                {t(`sessionCalendar.view${mode}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
