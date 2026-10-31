import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Search, UserPlus } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import { PersonAvatar } from './personVisual';
import type { PersonSummary } from './PersonDetail';

type Person = { personId: string; name: string };

type Props = {
  people: Person[];
  selected: string | null;
  onSelect: (personId: string) => void;
  summaries: Record<string, PersonSummary>;
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** Alerts, status lines and paging controls under the rows. */
  footer: ReactNode;
  notices: ReactNode;
};

function RowMeta({ summary }: { summary: PersonSummary | undefined }) {
  const { t } = useTranslation();
  if (!summary) return <span>{t('people.row.unknown')}</span>;
  if (summary.active === 0 && !summary.more)
    return <span className="text-warning">{t('people.row.noSamples')}</span>;
  return (
    <span>
      {t(summary.more ? 'people.row.samplesPartial' : 'people.row.samples', {
        count: summary.active,
      })}
    </span>
  );
}

/** Left column of Pessoas: header, search and one row per loaded person. */
export function PeopleList({
  people,
  selected,
  onSelect,
  summaries,
  search,
  onSearch,
  onAdd,
  onRefresh,
  refreshing,
  footer,
  notices,
}: Props) {
  const { t } = useTranslation();
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  function move(event: KeyboardEvent, index: number) {
    const last = people.length - 1;
    const next =
      event.key === 'ArrowDown'
        ? Math.min(last, index + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null || next === index) return;
    event.preventDefault();
    rows.current[next]?.focus();
    onSelect(people[next].personId);
  }

  return (
    <div className="flex w-[300px] shrink-0 flex-col border-r border-border">
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        <h1 id="people-heading" className="text-base font-semibold">
          {t('people.title')}
        </h1>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={t('people.refresh')}
            title={t('people.refresh')}
            icon={<RefreshCw size={14} aria-hidden="true" />}
            disabled={refreshing}
            onClick={onRefresh}
          />
          <Button
            size="sm"
            variant="primary"
            aria-haspopup="dialog"
            icon={<UserPlus size={14} aria-hidden="true" />}
            onClick={onAdd}
          >
            {t('people.add')}
          </Button>
        </div>
      </div>
      <div className="relative px-3.5 pt-2.5 pb-1.5">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-6 mt-0.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="pl-8"
          aria-label={t('people.search')}
          placeholder={t('people.search')}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      {notices}
      <div className="min-h-0 flex-1 overflow-auto">
        {people.length > 0 && (
          <ul aria-label={t('people.listLabel')}>
            {people.map((person, index) => {
              const summary = summaries[person.personId];
              const on = person.personId === selected;
              return (
                <li key={person.personId}>
                  <button
                    type="button"
                    ref={(el) => {
                      rows.current[index] = el;
                    }}
                    aria-current={on ? 'true' : undefined}
                    tabIndex={on || (!selected && index === 0) ? 0 : -1}
                    className={
                      'grid w-full grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 border-l-2 px-3.5 py-[9px] text-left text-ui transition-colors duration-(--m-instant) active:scale-[.992] ' +
                      (on ? 'border-primary bg-secondary' : 'border-transparent hover:bg-card')
                    }
                    onClick={() => onSelect(person.personId)}
                    onKeyDown={(event) => move(event, index)}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      <PersonAvatar personId={person.personId} name={person.name} />
                      <span className="truncate">{person.name}</span>
                    </span>
                    <span
                      className="text-right text-[11px] text-muted-foreground"
                      title={summary?.meetings ? t('people.row.meetingsLabel') : undefined}
                    >
                      {summary && summary.meetings > 0 && !summary.more
                        ? t('people.row.meetings', { count: summary.meetings })
                        : ''}
                    </span>
                    <span className="col-span-2 truncate text-xs text-muted-foreground">
                      <RowMeta summary={summary} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {footer}
      </div>
    </div>
  );
}
