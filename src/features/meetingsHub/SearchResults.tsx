import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import { EmptyState, Select } from '../../components/ui';
import { colourVar, useEventColour, useOutlookCategories } from '../agenda/categories';
import type { MeetingRow } from './meetingRows';
import { clockTime } from './format';
import {
  groupResults,
  highlight,
  peopleOf,
  type Period,
  type Result,
  type ResultFilters,
  type ResultGroup,
} from './searchResults';
import './calendarPeek.css';

type Props = {
  query: string;
  results: Result[];
  all: Result[];
  filters: ResultFilters;
  onFilters: (filters: ResultFilters) => void;
  searching: boolean;
  now: Date;
  selectedKey: string | null;
  onSelect: (row: MeetingRow) => void;
  onOpen: (row: MeetingRow) => void;
};

const PERIODS: Period[] = ['any', '30d', 'year'];

/** Search replaces the grid (spec 0107): results by period with the matched snippet. */
export function SearchResults(p: Props) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.home.${key}`, options);
  const groups = groupResults(p.results, p.now);
  const master = useOutlookCategories((s) => s.master);
  const people = [
    ...new Set(p.all.flatMap((r) => peopleOf(r.row).map((x) => x.name || x.email || ''))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const set = (patch: Partial<ResultFilters>) => p.onFilters({ ...p.filters, ...patch });
  return (
    <section className="ch-results" aria-label={k('resultsLabel', { query: p.query })}>
      <div className="ch-filters" role="group" aria-label={k('filters')}>
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            className="ch-filter"
            aria-pressed={p.filters.period === period}
            onClick={() => set({ period })}
          >
            {k(`period.${period}`)}
          </button>
        ))}
        <Select
          size="sm"
          aria-label={k('person')}
          value={p.filters.person ?? ''}
          onChange={(e) => set({ person: e.target.value || null })}
        >
          <option value="">{k('anyPerson')}</option>
          {people.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        {master.length > 0 && (
          <Select
            size="sm"
            aria-label={k('category')}
            value={p.filters.category ?? ''}
            onChange={(e) => set({ category: e.target.value || null })}
          >
            <option value="">{k('anyCategory')}</option>
            {master.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <button
          type="button"
          className="ch-filter"
          aria-pressed={p.filters.transcript}
          onClick={() => set({ transcript: !p.filters.transcript })}
        >
          {k('withTranscript')}
        </button>
      </div>
      {p.searching && !p.results.length ? (
        <p role="status" className="ch-results-note">
          {k('searching')}
        </p>
      ) : !p.results.length ? (
        <EmptyState
          icon={<SearchX size={18} aria-hidden="true" />}
          title={k('noResults', { query: p.query })}
          description={k('noResultsHint')}
        />
      ) : (
        groups.map((group) => <Group key={group.id} group={group} {...p} />)
      )}
    </section>
  );
}

function Group({ group, ...p }: Props & { group: ResultGroup }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const label =
    group.key.kind === 'month'
      ? capitalize(
          group.key.month.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
          locale
        )
      : t(`meetingsHub.home.group.${group.key.kind}`);
  return (
    <div role="group" aria-labelledby={`ch-group-${group.id}`}>
      <h3 id={`ch-group-${group.id}`} className="ch-results-group">
        {label}
      </h3>
      <ul className="ch-results-list">
        {group.results.map((result) => (
          <li key={result.row.key}>
            <ResultRow result={result} {...p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ result, ...p }: Props & { result: Result }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { row, matches } = result;
  const colour = useEventColour(row.kind === 'recording' ? null : row.event);
  const first = matches.find((m) => m.field !== 'title') ?? matches[0];
  const when = row.start
    ? `${row.start.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ${clockTime(row.start, locale)}`
    : t('meetingsHub.undated');
  return (
    <button
      type="button"
      className="ch-result"
      data-key={row.key}
      aria-expanded={p.selectedKey === row.key}
      onClick={() => p.onSelect(row)}
      onDoubleClick={() => p.onOpen(row)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        p.onOpen(row);
      }}
    >
      <span className="ch-result-when">{when}</span>
      <span className="min-w-0">
        <b className="ch-result-title">
          <Marked text={row.title || t('meetingsHub.untitled')} query={p.query} />
        </b>
        {first && first.field !== 'title' && (
          <span className="ch-result-snippet">
            <span className="ch-result-field">{t(`meetingsHub.home.field.${first.field}`)}: </span>
            <Marked text={first.snippet} query={p.query} />
          </span>
        )}
      </span>
      {colour && (
        <span className="ch-peek-chip" data-static="">
          <i
            className="ch-cat-swatch"
            aria-hidden="true"
            style={{ background: colourVar(colour.preset) }}
          />
          {colour.name}
        </span>
      )}
    </button>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, i) =>
        part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
      )}
    </>
  );
}

const capitalize = (text: string, locale: string) =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
