import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../../components/ui';
import { matchSettings, type SettingsRowEntry } from './settingsIndex';

/**
 * Find a setting (spec 0129 P4). A combobox: focus stays in the field, arrows
 * move, Enter opens, Escape clears. The results take the place of `children`.
 */
export function SettingsFilter({
  onPick,
  children,
}: {
  onPick: (entry: SettingsRowEntry) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`people.settings.filter.${key}`, options as never) as unknown as string;
  const id = useId();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const results = useMemo(
    () => matchSettings((key, options) => t(key, options as never) as unknown as string, query),
    [t, query]
  );
  const filtering = query.trim().length > 0;
  const optionId = (index: number) => `${id}-option-${index}`;

  const pick = (entry: SettingsRowEntry) => {
    setQuery('');
    setCursor(0);
    onPick(entry);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && filtering) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
      setCursor(0);
    } else if (event.key === 'Enter' && results[cursor]) {
      event.preventDefault();
      pick(results[cursor]);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (cursor + step + results.length) % results.length;
      setCursor(next);
      document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' });
    }
  };

  return (
    <>
      <div className="cx-settings-filter">
        <Search size={13} aria-hidden="true" className="cx-settings-filter-icon" />
        <Input
          size="sm"
          type="search"
          role="combobox"
          className="w-full"
          aria-label={k('label')}
          aria-expanded={filtering && results.length > 0}
          aria-controls={`${id}-results`}
          aria-autocomplete="list"
          aria-activedescendant={filtering && results.length ? optionId(cursor) : undefined}
          placeholder={k('placeholder')}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <p role="status" className="sr-only">
        {filtering ? k('found', { count: results.length }) : ''}
      </p>
      {filtering ? (
        <div className="cx-settings-results">
          {results.length === 0 && <p className="cx-settings-none">{k('none')}</p>}
          <ul id={`${id}-results`} role="listbox" aria-label={k('results')}>
            {results.map((entry, index) => (
              <li
                key={entry.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === cursor}
                className="cx-settings-result"
                data-active={index === cursor || undefined}
                // Keeps focus in the field until the row takes it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(entry)}
              >
                <span className="cx-settings-result-title">{t(entry.title)}</span>
                <span className="cx-settings-result-page">
                  {t(`people.settings.sections.${entry.section}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        children
      )}
    </>
  );
}
