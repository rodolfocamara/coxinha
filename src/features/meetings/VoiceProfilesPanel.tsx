import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { voiceCuration } from './voiceCuration';
import { useVoiceInventoryPages } from './useVoiceInventoryPages';
import { voiceCurationErrorText } from './voiceCurationError';
import { PersonVoiceSamples } from './PersonVoiceSamples';

/**
 * Collapsed voice memory inside a meeting's speaker review. The global
 * registry lives on the People screen (`src/features/people`).
 */
export function VoiceProfilesPanel({
  version,
  disabled,
  act,
}: {
  version: unknown;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`voiceCuration.${name}`);
  const [open, setOpen] = useState(false);
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
  const empty = query.loaded && query.items.length === 0 && !query.more;
  return (
    <details
      className="space-y-3 rounded-md border border-border p-4"
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer text-ui font-medium">{k('profiles')}</summary>
      {open && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
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
          {empty && (
            <p role="status" className="text-ui text-muted-foreground">
              {k('noProfiles')}
            </p>
          )}
          {query.items.length > 0 && (
            <ul className="space-y-2">
              {query.items.map((person) => (
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
      )}
    </details>
  );
}
