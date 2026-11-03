import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks } from 'lucide-react';
import { colourVar, useOutlookCategories } from '../agenda/categories';
import type { OutlookConnection } from '../agenda/useOutlookConnection';
import { MiniMonth } from './MiniMonth';
import { OutlookStatus } from './OutlookStatus';
import { NO_CATEGORY, useCalendarHome } from './calendarHome';

type Props = {
  anchor: Date;
  first: Date;
  last: Date;
  now: Date;
  onPick: (day: Date) => void;
  reviewCount: number;
  onReview: () => void;
  outlook: OutlookConnection;
  onOutlook: () => void;
  /** Calendar matches to review (spec 0100). */
  banner?: ReactNode;
};

/** Left of the calendar (spec 0107): jump to a day, filter categories, review. */
export function CalendarRail(p: Props) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.home.${key}`, options);
  return (
    <aside className="ch-rail" aria-label={k('rail')}>
      <MiniMonth anchor={p.anchor} first={p.first} last={p.last} now={p.now} onPick={p.onPick} />
      <CategoryFilter />
      {p.banner}
      <button type="button" className="ch-review" onClick={p.onReview}>
        <ListChecks size={14} aria-hidden="true" />
        <span className="flex-1">{k('review')}</span>
        {p.reviewCount > 0 && (
          <span className="mh-pill" data-tone="warning">
            <span className="sr-only">{k('reviewCount', { count: p.reviewCount })}</span>
            <span aria-hidden="true">{p.reviewCount}</span>
          </span>
        )}
      </button>
      <span className="flex-1" />
      <OutlookStatus connection={p.outlook} onOpen={p.onOutlook} />
    </aside>
  );
}

/** Outlook's "Meus calendários" checkboxes, one per category, plus "no category". */
function CategoryFilter() {
  const { t } = useTranslation();
  const master = useOutlookCategories((s) => s.master);
  const hidden = useCalendarHome((s) => s.hidden);
  const toggle = useCalendarHome((s) => s.toggleCategory);
  if (!master.length) return null;
  const entries = [
    ...master.map((c) => ({ key: c.name, name: c.name, preset: c.preset })),
    { key: NO_CATEGORY, name: t('meetingsHub.home.noCategory'), preset: null },
  ];
  return (
    <fieldset className="ch-cats">
      <legend>{t('meetingsHub.home.categories')}</legend>
      {entries.map((entry) => (
        <label key={entry.key || 'none'} className="ch-cat">
          <input
            type="checkbox"
            checked={!hidden.includes(entry.key)}
            onChange={() => toggle(entry.key)}
          />
          <i
            className="ch-cat-swatch"
            aria-hidden="true"
            data-empty={entry.preset === null || undefined}
            style={entry.preset === null ? undefined : { background: colourVar(entry.preset) }}
          />
          <span className="truncate">{entry.name}</span>
        </label>
      ))}
    </fieldset>
  );
}
