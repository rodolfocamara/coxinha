import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Search, UserPlus } from 'lucide-react';
import { Alert, Button, EmptyState, Input } from '../../components/ui';
import { voiceCuration } from './voiceCuration';
import { useVoiceInventoryPages } from './useVoiceInventoryPages';
import { voiceCurationErrorText } from './voiceCurationError';
import { PersonVoiceSamples } from './PersonVoiceSamples';

export function VoiceProfilesPanel({
  version,
  disabled,
  act,
  standalone = false,
  onAddPerson,
}: {
  version: unknown;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  standalone?: boolean;
  /** Standalone registry: offer creation from the empty state. */
  onAddPerson?: () => void;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`voiceCuration.${name}`);
  const [open, setOpen] = useState(standalone);
  const [search, setSearch] = useState('');
  const query = useVoiceInventoryPages(
    open,
    'profiles',
    version,
    async (cursor) => {
      const page = await voiceCuration.profilesPage(cursor);
      return { ...page, items: page.profiles };
    },
    (person) => person.personId
  );
  const visiblePeople = query.items.filter(
    (person) =>
      !standalone ||
      `${person.name} ${person.personId}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
  );
  const empty = query.loaded && query.items.length === 0 && !query.more;
  const content = open && (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {standalone && (
          <div className="relative min-w-56 flex-1">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              className="pl-8"
              aria-label={t('peopleDirectory.search')}
              placeholder={t('peopleDirectory.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}
        <Button
          variant="ghost"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          disabled={disabled || query.loading}
          onClick={query.restart}
        >
          {k(query.stale ? 'restartProfiles' : 'refresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{k('privateNotice')}</p>
      {query.loading && (
        <p role="status" className="text-ui text-muted-foreground">
          {k('loading')}
        </p>
      )}
      {query.stale && <Alert tone="warning">{k('staleView')}</Alert>}
      {!!query.error && <Alert tone="error">{voiceCurationErrorText(query.error, t)}</Alert>}
      {query.loaded && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(`voiceCuration.${query.more ? 'peopleLoadedPartial' : 'peopleLoadedComplete'}`, {
            count: query.items.length,
          })}
        </p>
      )}
      {empty &&
        (standalone ? (
          <div role="status">
            <EmptyState
              title={t('peopleDirectory.empty.title')}
              description={k('noProfiles')}
              action={
                onAddPerson && (
                  <Button
                    variant="primary"
                    icon={<UserPlus size={16} aria-hidden="true" />}
                    onClick={onAddPerson}
                  >
                    {t('peopleDirectory.addPerson')}
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <p role="status" className="text-ui text-muted-foreground">
            {k('noProfiles')}
          </p>
        ))}
      {standalone && search.trim() && query.loaded && visiblePeople.length === 0 && (
        <p role="status" className="text-ui text-muted-foreground">
          {t('peopleDirectory.noMatch')}
        </p>
      )}
      {visiblePeople.length > 0 && (
        <ul className="space-y-2">
          {visiblePeople.map((person) => (
            <li key={person.personId}>
              <PersonVoiceSamples
                person={person}
                version={version}
                generation={query.generation}
                onStale={query.invalidate}
                disabled={disabled || query.stale}
                act={act}
              />
            </li>
          ))}
        </ul>
      )}
      {query.more && (
        <Button
          size="sm"
          disabled={disabled || query.loading || query.stale}
          onClick={query.loadMore}
        >
          {k('loadMorePeople')}
        </Button>
      )}
    </div>
  );
  return standalone ? (
    <section aria-label={k('profiles')} className="space-y-3">
      {content}
    </section>
  ) : (
    <details
      className="space-y-3 rounded-md border border-border p-4"
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer text-ui font-medium">{k('profiles')}</summary>
      {content}
    </details>
  );
}
