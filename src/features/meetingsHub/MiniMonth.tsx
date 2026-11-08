import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui';
import { dayKey, monthStart, monthWeeks } from '../sessions/sessionDates';

/**
 * The rail's month (spec 0107): jump the calendar to any day. Days in view
 * are marked; the month shown follows the calendar until paged by hand.
 */
export function MiniMonth({
  anchor,
  first,
  last,
  now,
  onPick,
}: {
  anchor: Date;
  first: Date;
  last: Date;
  now: Date;
  onPick: (day: Date) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string) => t(`meetingsHub.home.${key}`);
  const [paged, setPaged] = useState<{ base: string; month: Date } | null>(null);
  // Paging is forgotten once the calendar itself moves to another month.
  const base = dayKey(monthStart(anchor));
  const month = paged && paged.base === base ? paged.month : monthStart(anchor);
  const page = (offset: number) => setPaged({ base, month: monthStart(month, offset) });
  const weeks = monthWeeks(month);
  const today = dayKey(now);
  const from = dayKey(first);
  const to = dayKey(last);
  const raw = month.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const label = raw.charAt(0).toLocaleUpperCase(locale) + raw.slice(1);
  return (
    <section className="ch-mini" aria-label={k('miniMonth')}>
      <div className="ch-mini-head">
        <b aria-live="polite">{label}</b>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<ChevronLeft size={13} aria-hidden="true" />}
          aria-label={k('previousMonth')}
          onClick={() => page(-1)}
        />
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<ChevronRight size={13} aria-hidden="true" />}
          aria-label={k('nextMonth')}
          onClick={() => page(1)}
        />
      </div>
      <div className="ch-mini-grid" role="group" aria-label={label}>
        {weeks[0].map((day) => (
          <span key={`h-${day.getDay()}`} className="ch-mini-wd" aria-hidden="true">
            {day.toLocaleDateString(locale, { weekday: 'narrow' })}
          </span>
        ))}
        {weeks.flat().map((day) => {
          const key = dayKey(day);
          return (
            <button
              key={key}
              type="button"
              className="ch-mini-day"
              data-outside={day.getMonth() !== month.getMonth() || undefined}
              data-in-view={(key >= from && key <= to) || undefined}
              aria-current={key === today ? 'date' : undefined}
              aria-label={day.toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
              onClick={() => {
                setPaged(null);
                onPick(day);
              }}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}
